import type {
  FontCollectionData,
  Glyph,
  FontMetrics,
  FontFormat,
  CmapTable,
  HeadTable,
  HheaTable,
  MaxpTable,
  NameRecord,
  Os2Table,
  PostTable,
  SfntData,
  WebFontContainerData,
} from './types/index.js'
import type { ColorLayer, PaintNode, ClipBox } from './parsers/tables/colr.js'
import {
  CPAL_USABLE_WITH_DARK_BACKGROUND,
  CPAL_USABLE_WITH_LIGHT_BACKGROUND,
} from './parsers/tables/cpal.js'
import type { PositionAdjustment } from './parsers/tables/gpos.js'
import type { OpenTypeLayoutFeatureRecord } from './parsers/tables/otl-common.js'
import type { VariationAxis, NamedInstance } from './parsers/tables/fvar.js'
import type { BitmapGlyphData } from './parsers/tables/bitmap-index.js'
import type { MathTable } from './parsers/tables/math.js'
import type { BaseResolutionContext, BaseTable } from './parsers/tables/base.js'
import type { JstfPriority, JstfTable } from './parsers/tables/jstf.js'
import type { GdefTable } from './parsers/tables/gdef.js'
import type { FeatTable } from './parsers/tables/feat.js'
import type { TrakTable } from './parsers/tables/trak.js'
import type { OpbdTable, OpbdBounds } from './parsers/tables/opbd.js'
import type { EbscTable } from './parsers/tables/ebsc.js'
import type { MorxFeatureSelector } from './parsers/tables/morx.js'
import type { JustTable } from './parsers/tables/just.js'
import type { BslnTable } from './parsers/tables/bsln.js'
import type { LcarTable } from './parsers/tables/lcar.js'
import type { MetaTable } from './parsers/tables/meta.js'
import type { PcltTable } from './parsers/tables/pclt.js'
import type { DsigTable } from './parsers/tables/dsig.js'
import type { LtagTable } from './parsers/tables/ltag.js'
import type { AcntGlyphAttachment, AcntTable } from './parsers/tables/acnt.js'
import type { AnkrAnchorPoint, AnkrTable } from './parsers/tables/ankr.js'
import type { FdscTable } from './parsers/tables/fdsc.js'
import type { FmtxTable } from './parsers/tables/fmtx.js'
import type { GcidTable } from './parsers/tables/gcid.js'
import {
  getComplementOffset,
  PROP_ATTACHES_ON_RIGHT,
  PROP_DIRECTIONALITY_MASK,
  PROP_FLOATER,
  PROP_HANG_OFF_LEFT_TOP,
  PROP_HANG_OFF_RIGHT_BOTTOM,
  PROP_USE_COMPLEMENTARY_BRACKET,
  type PropTable,
} from './parsers/tables/prop.js'
import type { ZapfGlyphInfo, ZapfTable } from './parsers/tables/zapf.js'
import type { MergGlyphGroup, MergTable } from './parsers/tables/merg.js'
import type { SilfTable, GlocTable, GlatTable, SillTable, GraphiteFeatTable } from './parsers/tables/graphite.js'
import { cffGlyphName, parseCffGlyphWithHints } from './parsers/cff-parser.js'
import { parseCff2Glyph, parseCff2GlyphWithHints } from './parsers/cff2-parser.js'
import { extractCffHintParams, applyCffHints } from './hinting/cff-hinter.js'
import { TrueTypeGlyphHinter } from './hinting/tt-glyph-hinter.js'
import type { TrueTypeHintingState, TrueTypeHintingTransform } from './hinting/tt-glyph-hinter.js'
import { rasterizeTrueTypeHintingState, type TrueTypeRasterBitmap } from './hinting/tt-rasterizer.js'
import {
  composeGlyphPoints,
  parseCompositeComponents,
  readSimpleGlyphData,
  WE_HAVE_INSTRUCTIONS,
} from './parsers/tables/glyf.js'
import { parseFont, type ParseFontOptions } from './parsers/index.js'
import { SfntTableManager } from './parsers/ttf-parser.js'
import type { StatAxisValue } from './parsers/tables/stat.js'
import { getTableReader, parseSfntDirectory } from './parsers/sfnt-parser.js'
import type { BitmapSizeRecord, BitmapMetrics } from './parsers/tables/bitmap-index.js'
import type { SbixGlyphData } from './parsers/tables/sbix.js'
import { collectFontGlyphReferences, subsetFont, subsetFontPreservingTables, type SubsetResult } from './subset/index.js'
import { buildFontCollection } from './subset/collection.js'
import { buildCffSfntWrapper, buildCidCffFromOutlines, type OutlineGlyph } from './subset/cff-subset.js'
import { computeJoiningPositions, isCursiveJoiningChar } from './arabic-joining.js'
import { getModifiedCombiningClass, getCombiningClass, isNonspacingMark, reorderMarkRuns } from './shaping/normalize.js'
import { preprocessThaiLao, isSaraAm, thaiPuaShaping } from './shaping/thai.js'
import {
  type ComplexScriptClass, type ShapeContext,
  COMPLEX_NONE, COMPLEX_INDIC, COMPLEX_KHMER, COMPLEX_MYANMAR, COMPLEX_HANGUL, COMPLEX_TIBETAN,
  COMPLEX_USE,
} from './shaping/complex.js'
import { shapeIndic, isIndicChar, normalizeIndic } from './shaping/indic.js'
import { shapeKhmer, isKhmerChar } from './shaping/khmer.js'
import { shapeMyanmar, isMyanmarChar } from './shaping/myanmar.js'
import { shapeHangul, isHangulChar } from './shaping/hangul.js'
import { shapeTibetan, isTibetanChar } from './shaping/tibetan.js'
import { shapeUse, isUseScriptChar } from './shaping/use.js'
import { deriveUseScriptTag } from './shaping/use-tables.js'
import { applyVowelConstraints } from './shaping/vowel-constraints.js'
import {
  GLYPH_FLAG_DEFAULT_IGNORABLE, GLYPH_FLAG_SUBSTITUTED, GSUB_MASK_GLOBAL,
  type GsubLookupModifications, type OpenTypeFeatureSetting,
} from './parsers/tables/gsub.js'
import { shapeGraphite, type GraphiteGlyphMetadata, type GraphiteJustificationOptions } from './shaping/graphite.js'
import { isDefaultIgnorable, isUnicodeDecimalNumber } from './shaping/unicode-general-category.js'
import { getUnicodeScript, getUnicodeScriptTag } from './shaping/unicode-shaping-properties.js'
import { getUnicodeVerticalOrientation } from './shaping/unicode-vertical-orientation.js'
import { buildGraphemeBoundaryFlags } from './layout/grapheme-break.js'
import {
  getShapingClass,
  CAT_N, CAT_H, CAT_ZWNJ, CAT_ZWJ, CAT_M, CAT_SM, CAT_A, CAT_RS, CAT_MPst,
  CAT_CM, CAT_VAbv, CAT_VBlw, CAT_VPre, CAT_VPst, CAT_As, CAT_MH, CAT_MR,
  CAT_MW, CAT_MY, CAT_PT, CAT_VS, CAT_ML, CAT_SMPst,
} from './shaping/ot-categories.js'
import { wrapWoff, type WoffWriteOptions } from './parsers/woff-parser.js'
import { wrapWoff2, wrapWoff2Collection, type Woff2WriteOptions } from './parsers/woff2-parser.js'
import {
  GASP_DOGRAY, GASP_GRIDFIT, GASP_SYMMETRIC_GRIDFIT, GASP_SYMMETRIC_SMOOTHING,
} from './parsers/tables/gasp.js'
import { validateOs2Conformance } from './parsers/tables/os2.js'
import { validateCmapConformance } from './parsers/tables/cmap.js'
import {
  verifyOpenTypeSignatures,
  type OpenTypeSignatureVerification,
} from './font-signature.js'

export interface FontDeviceMetrics {
  /** Horizontal and vertical pixels per em used for this device decision. */
  readonly xPpem: number
  readonly yPpem: number
  /** Integer horizontal advance selected for raster layout. */
  readonly advanceWidthPixels: number
  readonly advanceSource: 'linear' | 'hdmx' | 'interpreter'
  /** Whether LTSH/head semantics permit linear advance scaling at this size. */
  readonly linearAdvance: boolean
  /** Font-wide raster clipping bounds in pixels. */
  readonly verticalBounds: { readonly yMax: number; readonly yMin: number }
  readonly verticalBoundsSource: 'scaled' | 'VDMX'
  /** Raw gasp flags, or null when the font leaves the rasterizer policy unspecified. */
  readonly gaspBehavior: number | null
  readonly gridFit: boolean
  readonly grayscale: boolean
  readonly symmetricGridFit: boolean
  readonly symmetricSmoothing: boolean
}

export interface PostScriptMemoryUsage {
  readonly minType42: number
  readonly maxType42: number
  readonly minType1: number
  readonly maxType1: number
}

export interface FontEmbeddingPermissions {
  readonly level: 'installable' | 'restricted' | 'preview-print' | 'editable'
  readonly noSubsetting: boolean
  readonly bitmapOnly: boolean
}

export interface FontOpticalSizeRange {
  readonly lowerInclusive: number
  readonly upperExclusive: number | null
}

export interface FontOpenTypeLayoutFeature extends OpenTypeLayoutFeatureRecord {
  /** Source layout table containing this FeatureList record. */
  readonly table: 'GSUB' | 'GPOS'
}

/** A single glyph in a shaping result */
export interface ShapedGlyph {
  glyphId: number
  /** Zero-based input code-point index of the source cluster. */
  cluster: number
  xOffset: number
  yOffset: number
  xAdvance: number
  yAdvance: number
  /** For ligatures, the number of original code points this glyph replaced (default: 1) */
  componentCount: number
  /** UAX #50 sideways presentation required after vertical substitutions. */
  verticalRotation?: 0 | 90
  /** Graphite slot/association data when the font uses Graphite shaping. */
  graphite?: GraphiteGlyphMetadata
}

/** Shaping options */
export interface ShapeOptions {
  script?: string
  /** OpenType language system or BCP 47 tag; BCP 47 selects AAT `ltag` feature type 39. */
  language?: string
  features?: Set<string>
  /** Per-source-cluster OpenType feature values; later entries override earlier entries of the same tag. */
  featureSettings?: readonly OpenTypeFeatureSetting[]
  /** AAT feature/setting pairs advertised by the font's `feat` table. */
  aatFeatures?: readonly MorxFeatureSelector[]
  graphiteFeatures?: ReadonlyMap<number, number>
  graphiteJustification?: GraphiteJustificationOptions
  direction?: 'horizontal' | 'vertical'
  /** Selects AAT StartOfText/EndOfText or StartOfLine/EndOfLine state events. */
  aatBoundary?: 'text' | 'line'
  /** Per-glyph tracking adjustment in font units, used by legacy kern minimum subtables. */
  trackingAdjustment?: number
  /** One standalone JSTF priority suggestion applied while shaping. */
  jstf?: { readonly priority: JstfPriority, readonly mode: 'shrink' | 'extend' }
  /** Device pixels per em for OpenType Device-adjusted shaping metrics. */
  ppem?: number
}

function mergeJstfLookupPlan(
  selected: readonly number[],
  enabled: readonly number[],
  disabled: readonly number[],
): number[] {
  const plan = new Set<number>(selected)
  for (let i = 0; i < disabled.length; i++) plan.delete(disabled[i]!)
  for (let i = 0; i < enabled.length; i++) plan.add(enabled[i]!)
  return [...plan].sort((a, b) => a - b)
}

function continuesShapingCluster(codePoint: number): boolean {
  const category = getShapingClass(codePoint) & 0xFF
  return category === CAT_N || category === CAT_H || category === CAT_ZWNJ
    || category === CAT_ZWJ || category === CAT_M || category === CAT_SM
    || category === CAT_A || category === CAT_RS || category === CAT_MPst
    || category === CAT_CM || category === CAT_VAbv || category === CAT_VBlw
    || category === CAT_VPre || category === CAT_VPst || category === CAT_As
    || category === CAT_MH || category === CAT_MR || category === CAT_MW
    || category === CAT_MY || category === CAT_PT || category === CAT_VS
    || category === CAT_ML || category === CAT_SMPst
}

function getJstfGsubLookupModifications(options: ShapeOptions | undefined): GsubLookupModifications | null {
  const suggestion = options?.jstf
  if (suggestion === undefined) return null
  return suggestion.mode === 'extend'
    ? {
      enabled: suggestion.priority.gsubExtensionEnableLookups,
      disabled: suggestion.priority.gsubExtensionDisableLookups,
    }
    : {
      enabled: suggestion.priority.gsubShrinkageEnableLookups,
      disabled: suggestion.priority.gsubShrinkageDisableLookups,
    }
}

/** A named selector exposed by an AAT `feat` table. */
export interface AatFeatureSettingDescription {
  selector: number
  nameId: number
  name: string | null
  /** BCP 47 tag for feature type 39 selectors; null for selector 0 and other feature types. */
  languageTag: string | null
}

/** Public, resolved metadata for one AAT feature type. */
export interface AatFeatureDescription {
  featureType: number
  nameId: number
  name: string | null
  exclusive: boolean
  /** Selector equivalent to applying no setting, for exclusive features. */
  defaultSelector: number | null
  settings: readonly AatFeatureSettingDescription[]
}

/** Decoded semantics of one AAT `prop` property word. */
export interface AatGlyphProperties {
  raw: number
  floater: boolean
  hangsLeftOrTop: boolean
  hangsRightOrBottom: boolean
  usesComplementaryBracket: boolean
  complementaryGlyphId: number | null
  attachesOnRight: boolean
  directionalityClass: number
}

const VERTICAL_COMMON_FEATURES = ['abvm', 'blwm', 'ccmp', 'locl', 'mark', 'mkmk', 'rlig']
// HarfBuzz applies only the common GPOS features for vertical text; it does not
// enable vpal/valt/vkrn by default (those would proportionally re-space the CJK
// grid). Matching that keeps full-width glyphs on a 1em vertical advance.
const VERTICAL_GPOS_FEATURES = new Set(['abvm', 'blwm', 'mark', 'mkmk'])
const SINHALA_SHAPING_FEATURES = new Set([
  'locl', 'ccmp', 'nukt', 'akhn', 'rphf', 'rkrf', 'pref', 'blwf', 'abvf',
  'half', 'pstf', 'vatu', 'cjct', 'init', 'pres', 'abvs', 'blws', 'psts',
  'haln', 'calt', 'clig', 'rclt', 'dist', 'abvm', 'blwm', 'kern', 'mark', 'mkmk',
])

function isRightToLeftScriptTag(script: string | null): boolean {
  return script === 'adlm' || script === 'arab' || script === 'hebr' ||
    script === 'mand' || script === 'nko ' || script === 'rohg' ||
    script === 'samr' || script === 'syrc' || script === 'thaa'
}

function isRightToLeftCodePoint(cp: number): boolean {
  return (cp >= 0x0590 && cp <= 0x08FF) ||
    (cp >= 0x10D00 && cp <= 0x10D3F) ||
    (cp >= 0x1E900 && cp <= 0x1E95F) ||
    (cp >= 0xFB1D && cp <= 0xFDFF) ||
    (cp >= 0xFE70 && cp <= 0xFEFF)
}

/**
 * Automatic fractions (ISO/IEC 14496-22, HarfBuzz setup_masks_fraction): a
 * FRACTION SLASH (U+2044) with Unicode decimal digits before/after gets numr on
 * the numerator, dnom on the denominator, and frac across the run, applied with
 * per-glyph masks. Returns the substituted glyph list, or null when no fraction
 * is present.
 */
function applyAutoFraction(
  gsub: { applyShapingFeatures(buffer: { glyphs: number[], masks: number[] | null, clusters: number[] | null, syllables: number[] | null, aux: number[] | null, flags: number[] | null }, features: readonly { tag: string, mask: number, perSyllable: boolean }[], script?: string | null, language?: string | null, gdef?: unknown, coords?: number[] | null): void },
  glyphIds: number[],
  glyphFlags: number[],
  cps: readonly number[],
  script: string | null,
  language: string | null,
  gdef: unknown,
  coords: number[] | null,
): { glyphIds: number[], glyphFlags: number[] } | null {
  const NUMR = 2, DNOM = 4, FRAC = 8
  const masks = new Array<number>(glyphIds.length)
  for (let i = 0; i < masks.length; i++) masks[i] = GSUB_MASK_GLOBAL
  let any = false
  for (let i = 0; i < cps.length; i++) {
    if (cps[i] !== 0x2044) continue
    let start = i
    while (start > 0 && isUnicodeDecimalNumber(cps[start - 1]!)) start--
    let end = i
    while (end + 1 < cps.length && isUnicodeDecimalNumber(cps[end + 1]!)) end++
    if (start === i && end === i) continue
    any = true
    for (let j = start; j < i; j++) masks[j] = masks[j]! | NUMR | FRAC
    masks[i] = masks[i]! | FRAC
    for (let j = i + 1; j <= end; j++) masks[j] = masks[j]! | DNOM | FRAC
  }
  if (!any) return null
  const buffer = { glyphs: glyphIds.slice(), masks, clusters: null, syllables: null, aux: null, flags: glyphFlags.slice() }
  gsub.applyShapingFeatures(buffer, [
    { tag: 'numr', mask: NUMR, perSyllable: false },
    { tag: 'dnom', mask: DNOM, perSyllable: false },
    { tag: 'frac', mask: FRAC, perSyllable: false },
  ], script, language, gdef as never, coords)
  return { glyphIds: buffer.glyphs, glyphFlags: buffer.flags }
}

/**
 * Font-aware canonical composition (NFC) for the default shaper: recompose a
 * starter and a following combining mark into a precomposed code point when
 * canonical composition exists and the font has a glyph for it (matching the
 * OpenType default shaper's normalizer). Blocking marks (an intervening mark of
 * equal-or-higher combining class) prevent composition, per Unicode.
 */
function composeMarksToFontGlyphs(
  font: Font,
  cps: number[],
  clusters: number[],
  sourceClusters?: number[],
): void {
  let i = 1
  while (i < cps.length) {
    const markCcc = getCombiningClass(cps[i]!)
    if (markCcc === 0) { i++; continue }
    let starter = -1
    let blocked = false
    for (let j = i - 1; j >= 0; j--) {
      const jccc = getCombiningClass(cps[j]!)
      if (jccc === 0) { starter = j; break }
      if (jccc >= markCcc) { blocked = true; break }
    }
    if (starter >= 0 && !blocked) {
      const composed = canonicalComposePair(cps[starter]!, cps[i]!)
      if (composed !== 0 && font.getGlyphId(composed) !== 0) {
        cps[starter] = composed
        clusters[starter] = clusters[starter]! + clusters[i]!
        cps.splice(i, 1)
        clusters.splice(i, 1)
        if (sourceClusters !== undefined) {
          sourceClusters[starter] = Math.min(sourceClusters[starter]!, sourceClusters[i]!)
          sourceClusters.splice(i, 1)
        }
        continue
      }
    }
    i++
  }
}

/** Canonical composition of a starter + mark pair, or 0 when none exists. */
function canonicalComposePair(a: number, b: number): number {
  const composed = (String.fromCodePoint(a) + String.fromCodePoint(b)).normalize('NFC')
  const cp = composed.codePointAt(0)!
  // A single code point whose length covers the whole string means a and b
  // composed; otherwise NFC left them separate (no canonical composition).
  return composed.length === String.fromCodePoint(cp).length ? cp : 0
}

function inferCursiveJoiningScript(codePoints: readonly number[]): string | null {
  for (let i = 0; i < codePoints.length; i++) {
    const cp = codePoints[i]!
    if (isCursiveJoiningChar(cp)) return inferBaseScriptTag(cp)
  }
  return null
}

function buildVerticalGsubFeatures(
  gsub: NonNullable<SfntTableManager['gsub']>,
  userFeatures: Set<string> | undefined,
  script: string | null,
  language: string | null,
  normalizedCoords: number[] | null,
): Set<string> {
  const featureTags = userFeatures === undefined
    ? new Set(VERTICAL_COMMON_FEATURES)
    : new Set(userFeatures)
  // The default modern vertical path applies `vert`. An explicit `vrt2`
  // request selects the font's pre-rotated superset instead and overrides
  // `vert`, as required by the registered-feature interaction.
  if (featureTags.has('vrt2')) featureTags.delete('vert')
  else featureTags.add('vert')
  void gsub; void script; void language; void normalizedCoords
  return featureTags
}

function buildGposFeatures(userFeatures: Set<string> | undefined, vertical: boolean): Set<string> | null {
  if (!vertical) return userFeatures ?? null
  if (userFeatures !== undefined) return userFeatures
  return new Set(VERTICAL_GPOS_FEATURES)
}

function clampNormalizedCoordinate(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

function buildAatFeatureSelectors(
  feat: FeatTable | null,
  ltag: LtagTable | null,
  features: Set<string> | undefined,
  explicit: readonly MorxFeatureSelector[] | undefined,
  language: string | null,
): MorxFeatureSelector[] | undefined {
  if (explicit === undefined && features === undefined && language === null) return undefined
  const selectors: MorxFeatureSelector[] = []
  if (explicit !== undefined) {
    validateAatFeatureSelectors(feat, ltag, explicit)
    for (let i = 0; i < explicit.length; i++) selectors.push(explicit[i]!)
  }
  if (features !== undefined) {
    selectors.push({ featureType: 1, featureSetting: features.has('liga') ? 2 : 3 })
    selectors.push({ featureType: 1, featureSetting: features.has('dlig') ? 4 : 5 })
    selectors.push({ featureType: 1, featureSetting: features.has('clig') || features.has('calt') ? 18 : 19 })
    selectors.push({ featureType: 1, featureSetting: features.has('hlig') ? 20 : 21 })
  }
  if (language !== null && !hasAatFeatureType(selectors, 39) && feat !== null && ltag !== null) {
    const languageFeature = feat.getFeature(39)
    if (languageFeature !== null) {
      const normalizedLanguage = language.toLowerCase()
      let languageIndex = -1
      for (let i = 0; i < ltag.tags.length; i++) {
        if (ltag.tags[i]!.toLowerCase() === normalizedLanguage) {
          languageIndex = i
          break
        }
      }
      if (languageIndex >= 0) {
        const featureSetting = languageIndex + 1
        if (!hasFeatSelector(languageFeature, featureSetting)) {
          throw new Error(`AAT language ${language} maps to undeclared feature type 39 selector ${featureSetting}`)
        }
        selectors.push({ featureType: 39, featureSetting })
      }
    }
  }
  return selectors.length === 0 ? undefined : selectors
}

function validateAatFeatureSelectors(
  feat: FeatTable | null,
  ltag: LtagTable | null,
  selectors: readonly MorxFeatureSelector[],
): void {
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i]!
    if (!Number.isInteger(selector.featureType) || selector.featureType < 0 || selector.featureType > 0xFFFF) {
      throw new Error(`AAT feature type must be an unsigned 16-bit integer, got ${selector.featureType}`)
    }
    if (!Number.isInteger(selector.featureSetting) || selector.featureSetting < 0 || selector.featureSetting > 0xFFFF) {
      throw new Error(`AAT feature setting must be an unsigned 16-bit integer, got ${selector.featureSetting}`)
    }
    for (let j = 0; j < i; j++) {
      const previous = selectors[j]!
      if (previous.featureType !== selector.featureType) continue
      if (previous.featureSetting === selector.featureSetting) {
        throw new Error(`AAT feature type ${selector.featureType} selector ${selector.featureSetting} is selected more than once`)
      }
      const feature = feat?.getFeature(selector.featureType) ?? null
      if (feature !== null && (feature.featureFlags & 0x8000) !== 0) {
        throw new Error(`AAT exclusive feature type ${selector.featureType} has multiple selected settings`)
      }
      if (feature !== null && (previous.featureSetting >> 1) === (selector.featureSetting >> 1)) {
        throw new Error(`AAT non-exclusive feature type ${selector.featureType} selects both states of setting pair ${selector.featureSetting & 0xFFFE}`)
      }
    }
    if (feat !== null) {
      const feature = feat.getFeature(selector.featureType)
      if (feature === null) {
        throw new Error(`AAT feature type ${selector.featureType} is not declared by the feat table`)
      }
      if (!hasFeatSelector(feature, selector.featureSetting)) {
        throw new Error(`AAT feature type ${selector.featureType} does not declare selector ${selector.featureSetting}`)
      }
    }
    if (selector.featureType === 39 && selector.featureSetting > 0 &&
        (ltag === null || ltag.getTag(selector.featureSetting - 1) === null)) {
      throw new Error(`AAT language selector ${selector.featureSetting} has no ltag entry`)
    }
  }
}

function hasFeatSelector(feature: FeatTable['features'][number], selector: number): boolean {
  for (let i = 0; i < feature.selectors.length; i++) {
    const declared = feature.selectors[i]!.selectorValue
    if (declared === selector) return true
    if ((feature.featureFlags & 0x8000) === 0 && (selector & 1) !== 0 && declared === selector - 1) return true
  }
  return false
}

function hasAatFeatureType(selectors: readonly MorxFeatureSelector[], featureType: number): boolean {
  for (let i = 0; i < selectors.length; i++) {
    if (selectors[i]!.featureType === featureType) return true
  }
  return false
}

function inferBaseScriptTag(cp: number): string | null {
  const tag = getUnicodeScriptTag(cp)
  switch (tag) {
    case 'Zyyy':
    case 'Zinh':
    case 'Zzzz': return null
    case 'Hira': return 'kana'
    case 'Laoo': return 'lao '
    case 'Nkoo': return 'nko '
    case 'Vaii': return 'vai '
    case 'Yiii': return 'yi  '
    default: return tag.toLowerCase()
  }
}

// Old → new (v2) OpenType script tags for the Indic scripts the Indic shaper
// handles. HarfBuzz uses the Indic shaper when the font declares either tag.
const INDIC_OT_TAG_PAIRS: Record<string, [string, string]> = {
  deva: ['deva', 'dev2'], beng: ['beng', 'bng2'], guru: ['guru', 'gur2'],
  gujr: ['gujr', 'gjr2'], orya: ['orya', 'ory2'], taml: ['taml', 'tml2'],
  telu: ['telu', 'tel2'], knda: ['knda', 'knd2'], mlym: ['mlym', 'mlm2'],
  sinh: ['sinh', 'sinh'],
}

/**
 * The [old, v2] OpenType script tags for the Indic script of a run, or null
 * when it cannot be determined. Uses the caller's requested tag when given,
 * otherwise the first Indic code point.
 */
function indicOtScriptTags(script: string | null, cps: readonly number[]): [string, string] | null {
  if (script !== null) {
    const base = script.endsWith('2') ? script.slice(0, 3) : script
    for (const key of Object.keys(INDIC_OT_TAG_PAIRS)) {
      if (key === base || key.startsWith(base.slice(0, 3))) return INDIC_OT_TAG_PAIRS[key]!
    }
  }
  for (let i = 0; i < cps.length; i++) {
    const tag = inferBaseScriptTag(cps[i]!)
    if (tag !== null && INDIC_OT_TAG_PAIRS[tag] !== undefined) return INDIC_OT_TAG_PAIRS[tag]!
  }
  return null
}

function buildBaseScripts(codePoints: readonly number[], explicitScript: string | null): string[] {
  const scripts = new Array<string>(codePoints.length)
  let lastScript = explicitScript ?? 'latn'
  for (let i = 0; i < codePoints.length; i++) {
    const cp = codePoints[i]!
    const inferred = getModifiedCombiningClass(cp) === 0 ? inferBaseScriptTag(cp) : null
    if (inferred !== null) lastScript = inferred
    scripts[i] = lastScript
  }
  return scripts
}

function findBaselineCoordinate(values: readonly { tag: string; coordinate: number }[], tag: string): number | null {
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!
    if (value.tag === tag) return value.coordinate
  }
  return null
}

/**
 * Font loading options
 */
export interface FontLoadOptions extends ParseFontOptions {}

/**
 * Bitmap glyph data normalized for rendering.
 * All pixel metrics are relative to the glyph origin on the baseline,
 * with the y axis pointing up (font coordinate convention).
 */
export interface BitmapGlyphRenderData {
  /** Image payload kind ('mask' and 'bgra' are raw embedded bitmap data). */
  image: 'png' | 'jpeg' | 'tiff' | 'mask' | 'bgra'
  /** Image bytes (PNG/JPEG/TIFF) or raw bitmap rows (mask) */
  data: Uint8Array
  /** Strike ppem the bitmap was selected from (pixels per em) */
  ppem: number
  /** Horizontal strike pixels per em. */
  ppemX: number
  /** Vertical strike pixels per em. */
  ppemY: number
  /** Device pixel density of the selected sbix strike. */
  ppi?: number
  /** Bitmap width in pixels (0 = derive from the image data; sbix carries no metrics) */
  width: number
  /** Bitmap height in pixels (0 = derive from the image data) */
  height: number
  /** Horizontal offset from the origin to the bitmap's left edge (px) */
  bearingX: number
  /** Vertical offset from the baseline to the bitmap's bottom edge (px, y-up) */
  bottom: number
  /** mask only: bits per pixel (1/2/4/8) */
  bitDepth?: number
  /** mask only: rows are bit-aligned (formats 2/5/7) instead of byte-aligned */
  bitAligned?: boolean
  /** Draw the scalable outline over the bitmap, as requested by sbix flags bit 1. */
  drawOutlines?: boolean
}

export interface ColorPaletteColor {
  r: number
  g: number
  b: number
  a: number
}

export interface ColorPaletteInfo {
  index: number
  usableWithLightBackground: boolean
  usableWithDarkBackground: boolean
  label: string | null
  entryLabels: readonly (string | null)[]
}

function appendOpenTypeLayoutFeatures(
  target: FontOpenTypeLayoutFeature[],
  table: 'GSUB' | 'GPOS',
  records: readonly OpenTypeLayoutFeatureRecord[],
): void {
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const params = record.params?.kind === 'character-variant'
      ? { ...record.params, characters: [...record.params.characters] }
      : record.params === null ? null : { ...record.params }
    target.push({
      table,
      featureIndex: record.featureIndex,
      tag: record.tag,
      lookupIndices: [...record.lookupIndices],
      params,
    })
  }
}

/**
 * Public font API
 * Supports TTF, OTF, TTC, OTC, WOFF, WOFF2, and EOT
 * Provides fast access via a glyph cache
 */
export class Font {
  private readonly tableManager: SfntTableManager
  private readonly glyphCache = new Map<number, Glyph>()
  private readonly trueTypeVariationMetricsCache = new Map<number, {
    advanceHeightDelta: number
    verticalOriginDelta: number
    xMin: number
    xMax: number
    yMin: number
    yMax: number
  }>()
  private readonly defaultTrueTypeYMaxCache = new Map<number, number>()
  private readonly trueTypeMetricsGlyphCache = new Map<number, number>()
  private metricsCache: FontMetrics | null = null
  /** TrueType grid-fitting engine (undefined = not built yet, null = not applicable) */
  private ttHinter: TrueTypeGlyphHinter | null | undefined = undefined
  private readonly hintedGlyphCache = new Map<string, Glyph>()
  private readonly glyphRenderCapabilities: number

  /** Clamped user-space variation coordinates (null at defaults) */
  private currentUserCoords: Record<string, number> | null = null
  private selectedColorPaletteIndex = 0
  private colorPaletteOverrides: ReadonlyMap<number, ColorPaletteColor> | null = null

  private constructor(tableManager: SfntTableManager) {
    this.tableManager = tableManager
    const directory = tableManager.sfnt.tableDirectory
    this.glyphRenderCapabilities = (directory.has('COLR') ? 1 : 0)
      | (directory.has('SVG ') ? 2 : 0)
      | (directory.has('sbix')
        || (directory.has('CBDT') && directory.has('CBLC'))
        || (directory.has('EBDT') && directory.has('EBLC'))
        || (directory.has('bdat') && directory.has('bloc')) ? 4 : 0)
  }

  /**
   * Loads a font from an ArrayBuffer
   * Supports all formats: TTF, OTF, TTC, OTC, WOFF, WOFF2, EOT
   */
  static load(buffer: ArrayBuffer, options?: FontLoadOptions): Font {
    const sfnt = parseFont(buffer, options)
    const tableManager = new SfntTableManager(sfnt)
    const font = new Font(tableManager)
    if (options?.conformance === 'opentype-1.9.1') font.validateOpenTypeConformance()
    return font
  }

  /** Validates normative OpenType 1.9.1 constraints that span decoded tables. */
  validateOpenTypeConformance(): void {
    const tm = this.tableManager
    const directory = tm.sfnt.tableDirectory
    const requiredTables = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post']
    for (let i = 0; i < requiredTables.length; i++) {
      const tag = requiredTables[i]!
      if (!directory.has(tag)) {
        const article = tag === 'OS/2' ? 'an' : 'a'
        throw new Error(`OpenType 1.9.1 conformance requires ${article} ${tag} table`)
      }
    }
    const os2 = tm.os2
    validateOs2Conformance(os2)
    validateCmapConformance(tm.cmap, tm.maxp.numGlyphs, tm.isCff)
    const macStyle = tm.head.macStyle
    if (((os2.fsSelection & 0x0001) !== 0) !== ((macStyle & 0x0002) !== 0)) {
      throw new Error('OpenType 1.9.1 requires OS/2 fsSelection ITALIC to match head.macStyle')
    }
    if (((os2.fsSelection & 0x0020) !== 0) !== ((macStyle & 0x0001) !== 0)) {
      throw new Error('OpenType 1.9.1 requires OS/2 fsSelection BOLD to match head.macStyle')
    }
    if (tm.fvar !== null) {
      if ((os2.fsSelection & 0x0080) === 0) {
        throw new Error('OpenType 1.9.1 variable fonts require OS/2 USE_TYPO_METRICS')
      }
      const hhea = tm.hhea
      if (hhea.ascender !== os2.typoAscender || hhea.descender !== os2.typoDescender || hhea.lineGap !== os2.typoLineGap) {
        throw new Error('OpenType 1.9.1 variable fonts require hhea line metrics to match OS/2 typographic metrics')
      }
    }
    this.validateCoreTableConformance()
    this.validateTableCombinationConformance()
    validateSfntChecksums(tm.sfnt)
  }

  private validateTableCombinationConformance(): void {
    const tm = this.tableManager
    const directory = tm.sfnt.tableDirectory
    const requireTogether = function (first: string, second: string): void {
      if (directory.has(first) !== directory.has(second)) {
        throw new Error(`OpenType 1.9.1 requires ${first} and ${second} tables to occur together`)
      }
    }
    requireTogether('CBDT', 'CBLC')
    requireTogether('EBDT', 'EBLC')
    if (directory.has('EBSC') && !directory.has('EBLC')) throw new Error('OpenType EBSC requires an EBLC table')
    if (directory.has('COLR') && !directory.has('CPAL')) throw new Error('OpenType COLR requires a CPAL table')
    if (directory.has('VORG') && !directory.has('CFF ') && !directory.has('CFF2')) {
      throw new Error('OpenType VORG requires CFF or CFF2 outlines')
    }

    const fvarRequired = ['avar', 'cvar', 'gvar', 'HVAR', 'MVAR', 'VVAR']
    for (let i = 0; i < fvarRequired.length; i++) {
      const tag = fvarRequired[i]!
      if (directory.has(tag) && !directory.has('fvar')) throw new Error(`OpenType ${tag} requires an fvar table`)
    }
    if ((directory.has('gvar') || directory.has('cvar')) && !directory.has('glyf')) {
      throw new Error('OpenType gvar and cvar are valid only with glyf outlines')
    }
    if (directory.has('fvar') && directory.has('CFF ')) {
      throw new Error('OpenType variable CFF outlines must use CFF2 rather than CFF')
    }

    if (directory.has('CFF2')) {
      const cff2 = tm.cff2
      if (cff2 === null) throw new Error('OpenType CFF2 table could not be parsed')
      if (cff2.charstrings.count !== tm.maxp.numGlyphs) {
        throw new Error(`CFF2 CharString count ${cff2.charstrings.count} must match maxp.numGlyphs ${tm.maxp.numGlyphs}`)
      }
      if (tm.head.indexToLocFormat !== 0 || tm.head.glyphDataFormat !== 0) {
        throw new Error('CFF2 fonts require head.indexToLocFormat and glyphDataFormat to be zero')
      }
      const expectedScale = 1 / tm.head.unitsPerEm
      if (cff2.fontMatrix === null) {
        if (tm.head.unitsPerEm !== 1000) throw new Error('CFF2 requires FontMatrix when unitsPerEm is not 1000')
      } else if (Math.abs(cff2.fontMatrix[0]! - expectedScale) > 1e-10) {
        throw new Error('CFF2 FontMatrix scale must be the reciprocal of head.unitsPerEm')
      }
    }
  }

  private validateCoreTableConformance(): void {
    const tm = this.tableManager
    const directory = tm.sfnt.tableDirectory
    const hasGlyf = directory.has('glyf')
    const hasLoca = directory.has('loca')
    const hasCff1 = directory.has('CFF ')
    const hasCff2 = directory.has('CFF2')
    const outlineCount = (hasGlyf ? 1 : 0) + (hasCff1 ? 1 : 0) + (hasCff2 ? 1 : 0)
    const hasBitmapGlyphs = (directory.has('CBDT') && directory.has('CBLC'))
      || (directory.has('EBDT') && directory.has('EBLC'))
    if (outlineCount > 1 || (outlineCount === 0 && !hasBitmapGlyphs)) {
      throw new Error('OpenType 1.9.1 conformance requires one outline format or an embedded-bitmap glyph format')
    }
    if (hasGlyf !== hasLoca) {
      throw new Error('OpenType 1.9.1 requires glyf and loca tables to occur together')
    }
    const maxp = tm.maxp
    if (hasGlyf && maxp.version !== 1.0) {
      throw new Error('OpenType TrueType outlines require maxp version 1.0')
    }
    if (hasGlyf && maxp.version === 1.0 && maxp.maxZones !== 1 && maxp.maxZones !== 2) {
      throw new Error(`OpenType TrueType outlines require maxp.maxZones to be 1 or 2, got ${maxp.maxZones}`)
    }
    if ((hasCff1 || hasCff2) && maxp.version !== 0.5) {
      throw new Error('OpenType CFF outlines require maxp version 0.5')
    }

    const head = tm.head
    if ((head.flags & 0x07E0) !== 0) {
      throw new Error('OpenType 1.9.1 requires unused head.flags bits 5 through 10 to be clear')
    }
    if (head.fontDirectionHint !== 2) {
      throw new Error(`OpenType 1.9.1 requires deprecated head.fontDirectionHint to be 2, got ${head.fontDirectionHint}`)
    }

    const hhea = tm.hhea
    const hmtx = tm.hmtx
    let advanceWidthMax = 0
    let minLeftSideBearing = 0
    let minRightSideBearing = 0
    let xMaxExtent = 0
    let fontXMin = 0
    let fontYMin = 0
    let fontXMax = 0
    let fontYMax = 0
    let hasContourGlyph = false
    const variableTrueType = hasGlyf && tm.fvar !== null
    const glyfReader = hasGlyf ? getTableReader(tm.sfnt, 'glyf')! : null
    const compositeComponents = new Map<number, readonly number[]>()
    const compositeGlyphIds: number[] = []

    for (let glyphId = 0; glyphId < maxp.numGlyphs; glyphId++) {
      const advanceWidth = hmtx.advanceWidths[glyphId]!
      const leftSideBearing = hmtx.leftSideBearings[glyphId]!
      if (advanceWidth > advanceWidthMax) advanceWidthMax = advanceWidth
      let glyphXMin = 0
      let glyphYMin = 0
      let glyphXMax = 0
      let glyphYMax = 0
      let hasContours = false
      if (glyfReader) {
        const glyphLength = tm.loca.getLength(glyphId)
        if (glyphLength >= 10) {
          const reader = glyfReader.subReader(tm.loca.getOffset(glyphId), glyphLength)
          const numberOfContours = reader.readInt16()
          hasContours = numberOfContours !== 0
          glyphXMin = reader.readInt16()
          glyphYMin = reader.readInt16()
          glyphXMax = reader.readInt16()
          glyphYMax = reader.readInt16()
          if (glyphXMin > glyphXMax || glyphYMin > glyphYMax) {
            throw new Error(`glyf glyph ${glyphId} has an invalid bounding box`)
          }
          if (numberOfContours >= 0) {
            const raw = readSimpleGlyphData(reader, numberOfContours)
            if (raw.numPoints > maxp.maxPoints!) {
              throw new Error(`glyf glyph ${glyphId} has ${raw.numPoints} points, exceeding maxp.maxPoints ${maxp.maxPoints}`)
            }
            if (numberOfContours > maxp.maxContours!) {
              throw new Error(`glyf glyph ${glyphId} has ${numberOfContours} contours, exceeding maxp.maxContours ${maxp.maxContours}`)
            }
            if (raw.instructions.length > maxp.maxSizeOfInstructions!) {
              throw new Error(`glyf glyph ${glyphId} has ${raw.instructions.length} instruction bytes, exceeding maxp.maxSizeOfInstructions ${maxp.maxSizeOfInstructions}`)
            }
            if (raw.numPoints > 0) {
              let pointXMin = raw.xCoords[0]!
              let pointYMin = raw.yCoords[0]!
              let pointXMax = pointXMin
              let pointYMax = pointYMin
              for (let i = 1; i < raw.numPoints; i++) {
                const x = raw.xCoords[i]!
                const y = raw.yCoords[i]!
                if (x < pointXMin) pointXMin = x
                if (x > pointXMax) pointXMax = x
                if (y < pointYMin) pointYMin = y
                if (y > pointYMax) pointYMax = y
              }
              if (glyphXMin !== pointXMin || glyphYMin !== pointYMin || glyphXMax !== pointXMax || glyphYMax !== pointYMax) {
                throw new Error(`glyf glyph ${glyphId} bounding box does not match its control points`)
              }
            }
          } else {
            const components = parseCompositeComponents(reader)
            if (components.length > maxp.maxComponentElements!) {
              throw new Error(`glyf glyph ${glyphId} has ${components.length} components, exceeding maxp.maxComponentElements ${maxp.maxComponentElements}`)
            }
            for (let i = 0; i < components.length; i++) {
              if (components[i]!.glyphId >= maxp.numGlyphs) {
                throw new Error(`glyf glyph ${glyphId} references out-of-range component glyph ${components[i]!.glyphId}`)
              }
            }
            const hasInstructions = components.some(function (component) {
              return (component.flags & WE_HAVE_INSTRUCTIONS) !== 0
            })
            if (hasInstructions) {
              const instructionLength = reader.readUint16()
              if (instructionLength > maxp.maxSizeOfInstructions!) {
                throw new Error(`glyf glyph ${glyphId} has ${instructionLength} instruction bytes, exceeding maxp.maxSizeOfInstructions ${maxp.maxSizeOfInstructions}`)
              }
              reader.readBytes(instructionLength)
            }
            compositeComponents.set(glyphId, components.map(function (component) { return component.glyphId }))
            compositeGlyphIds.push(glyphId)
          }
        }
      } else if (outlineCount !== 0) {
        const glyph = tm.getGlyphOutline(glyphId)
        hasContours = glyph.outline.commands.length !== 0
        glyphXMin = Math.floor(glyph.xMin)
        glyphYMin = Math.floor(glyph.yMin)
        glyphXMax = Math.ceil(glyph.xMax)
        glyphYMax = Math.ceil(glyph.yMax)
      }
      if (variableTrueType && leftSideBearing !== glyphXMin) {
        throw new Error(`OpenType variable TrueType glyph ${glyphId} requires hmtx lsb to equal xMin`)
      }
      if (!hasContours) continue
      const extent = glyphXMax - glyphXMin
      const rightSideBearing = advanceWidth - (leftSideBearing + extent)
      const glyphXMaxExtent = leftSideBearing + extent
      if (!hasContourGlyph) {
        minLeftSideBearing = leftSideBearing
        minRightSideBearing = rightSideBearing
        xMaxExtent = glyphXMaxExtent
        fontXMin = glyphXMin
        fontYMin = glyphYMin
        fontXMax = glyphXMax
        fontYMax = glyphYMax
        hasContourGlyph = true
      } else {
        if (leftSideBearing < minLeftSideBearing) minLeftSideBearing = leftSideBearing
        if (rightSideBearing < minRightSideBearing) minRightSideBearing = rightSideBearing
        if (glyphXMaxExtent > xMaxExtent) xMaxExtent = glyphXMaxExtent
        if (glyphXMin < fontXMin) fontXMin = glyphXMin
        if (glyphYMin < fontYMin) fontYMin = glyphYMin
        if (glyphXMax > fontXMax) fontXMax = glyphXMax
        if (glyphYMax > fontYMax) fontYMax = glyphYMax
      }
    }

    if (glyfReader) {
      const depths = new Map<number, number>()
      const visiting = new Set<number>()
      const componentDepth = function (glyphId: number): number {
        const known = depths.get(glyphId)
        if (known !== undefined) return known
        if (visiting.has(glyphId)) throw new Error(`glyf composite graph contains a cycle at glyph ${glyphId}`)
        const components = compositeComponents.get(glyphId)
        if (components === undefined) return 0
        visiting.add(glyphId)
        let depth = 1
        for (let i = 0; i < components.length; i++) {
          const childDepth = 1 + componentDepth(components[i]!)
          if (childDepth > depth) depth = childDepth
        }
        visiting.delete(glyphId)
        depths.set(glyphId, depth)
        return depth
      }
      for (let i = 0; i < compositeGlyphIds.length; i++) {
        const glyphId = compositeGlyphIds[i]!
        const depth = componentDepth(glyphId)
        if (depth > maxp.maxComponentDepth!) {
          throw new Error(`glyf glyph ${glyphId} component depth ${depth} exceeds maxp.maxComponentDepth ${maxp.maxComponentDepth}`)
        }
        const composed = composeGlyphPoints(glyfReader, tm.loca, glyphId, null, null, tm.glyphPhantomPointProvider)
        if (composed.numPoints > maxp.maxCompositePoints!) {
          throw new Error(`glyf glyph ${glyphId} has ${composed.numPoints} composite points, exceeding maxp.maxCompositePoints ${maxp.maxCompositePoints}`)
        }
        if (composed.endPts.length > maxp.maxCompositeContours!) {
          throw new Error(`glyf glyph ${glyphId} has ${composed.endPts.length} composite contours, exceeding maxp.maxCompositeContours ${maxp.maxCompositeContours}`)
        }
      }
    }

    if (hhea.advanceWidthMax !== advanceWidthMax) {
      throw new Error(`hhea advanceWidthMax ${hhea.advanceWidthMax} does not match hmtx maximum ${advanceWidthMax}`)
    }
    if (hasContourGlyph && (
      hhea.minLeftSideBearing !== minLeftSideBearing ||
      hhea.minRightSideBearing !== minRightSideBearing ||
      hhea.xMaxExtent !== xMaxExtent
    )) {
      throw new Error('hhea side-bearing extrema do not match glyph outlines and hmtx metrics')
    }
    if (hasContourGlyph && (
      head.xMin !== fontXMin || head.yMin !== fontYMin ||
      head.xMax !== fontXMax || head.yMax !== fontYMax
    )) {
      throw new Error('head bounding box does not match the union of glyphs with contours')
    }
    if (variableTrueType && (head.flags & 0x0002) === 0) {
      throw new Error('OpenType variable TrueType fonts require head.flags bit 1')
    }
  }

  /** Font format */
  get format(): FontFormat {
    return this.tableManager.sfnt.format
  }

  /** WOFF/WOFF2 container metadata and private data. */
  get webFontContainer(): WebFontContainerData | null {
    return this.tableManager.sfnt.webFontContainer ?? null
  }

  /** Collection metadata for TTC/OTC resources. */
  get collection(): FontCollectionData | null {
    return this.tableManager.sfnt.collection ?? null
  }

  /** Loads another face from the same TTC/OTC resource. */
  getCollectionFont(fontIndex: number): Font {
    if (this.tableManager.sfnt.collection === undefined) {
      throw new Error('Font is not part of a TTC/OTC collection')
    }
    return Font.load(this.tableManager.sfnt.buffer, { fontIndex })
  }

  /** Packages this font resource as WOFF 1.0. */
  toWoff(options?: WoffWriteOptions): ArrayBuffer {
    return wrapWoff(this.tableManager.sfnt, options)
  }

  /** Packages this font resource as WOFF2 using null table transforms. */
  toWoff2(options?: Woff2WriteOptions): ArrayBuffer {
    if (this.tableManager.sfnt.collection !== undefined) {
      return wrapWoff2Collection(this.tableManager.sfnt.buffer, options)
    }
    return wrapWoff2(this.tableManager.sfnt, options)
  }

  /** Whether this is a CFF-based font */
  get isCff(): boolean {
    return this.tableManager.isCff
  }

  /** Whether the font carries scalable glyph outlines (glyf / CFF / CFF2), as
   *  opposed to being bitmap-only. Used to prefer outlines over monochrome
   *  embedded bitmaps (EBDT) for resolution-independent output. */
  get hasScalableOutlines(): boolean {
    return this.tableManager.isCff || getTableReader(this.tableManager.sfnt, 'glyf') !== null
  }

  /** Whether this font contains COLR glyph paint data. */
  get hasColrGlyphs(): boolean {
    return (this.glyphRenderCapabilities & 1) !== 0
  }

  /** Whether this font contains OpenType SVG glyph documents. */
  get hasSvgGlyphs(): boolean {
    return (this.glyphRenderCapabilities & 2) !== 0
  }

  /** Whether this font contains an embedded bitmap glyph format. */
  get hasEmbeddedBitmapGlyphs(): boolean {
    return (this.glyphRenderCapabilities & 4) !== 0
  }

  /** Whether this is a CFF2 variable-outline font. */
  get isCff2(): boolean {
    return this.tableManager.isCff2
  }

  /** Complete OpenType head fields for revision, bounds, scaler policy, and loca selection. */
  get fontHeader(): HeadTable {
    return { ...this.tableManager.head }
  }

  /** Complete OpenType hhea fields that define horizontal layout and caret geometry. */
  get horizontalHeader(): HheaTable {
    return { ...this.tableManager.hhea }
  }

  /** Complete maxp memory profile used by outline composition and TrueType hinting. */
  get maximumProfile(): MaxpTable {
    return { ...this.tableManager.maxp }
  }

  /** Font name (family name) */
  get familyName(): string {
    return this.tableManager.name.getName(1) ?? ''
  }

  /** Font subfamily name */
  get subfamilyName(): string {
    return this.tableManager.name.getName(2) ?? ''
  }

  /** Full name */
  get fullName(): string {
    return this.tableManager.name.getName(4) ?? ''
  }

  /** PostScript name */
  get postScriptName(): string {
    return this.tableManager.name.getName(6) ?? ''
  }

  /** Resolves any standard or custom name ID using the name table's language precedence. */
  getName(nameId: number, language?: number | string): string | undefined {
    return this.tableManager.name.getName(nameId, language)
  }

  /** Complete decoded name records, including exact bytes for uninterpreted custom data. */
  get nameRecords(): readonly NameRecord[] {
    return this.tableManager.name.records.map(function (record) {
      return record.rawValue === undefined ? { ...record } : { ...record, rawValue: record.rawValue.slice() }
    })
  }

  /** Glyph name from the OpenType post table or the CFF charset. */
  getGlyphName(glyphId: number): string | null {
    if (glyphId < 0 || glyphId >= this.numGlyphs) throw new Error(`Glyph ID ${glyphId} exceeds font glyph count`)
    const postName = this.tableManager.sfnt.tableDirectory.has('post')
      ? this.tableManager.post.glyphNames?.[glyphId]
      : undefined
    if (postName !== undefined) return postName
    const cff = this.tableManager.cff
    return cff === null ? null : cffGlyphName(cff, glyphId)
  }

  /** PostScript virtual-memory estimates declared by the OpenType post table. */
  get postScriptMemoryUsage(): PostScriptMemoryUsage {
    const post = this.tableManager.post
    return {
      minType42: post.minMemType42,
      maxType42: post.maxMemType42,
      minType1: post.minMemType1,
      maxType1: post.maxMemType1,
    }
  }

  /** Complete post table metadata, including format-specific glyph names or character codes. */
  get postMetadata(): PostTable {
    const post = this.tableManager.post
    return {
      ...post,
      glyphNames: post.glyphNames === undefined ? undefined : [...post.glyphNames],
      glyphNameCharacterCodes: post.glyphNameCharacterCodes?.slice(),
    }
  }

  /** Complete OS/2 classification and metric data. */
  get os2Metadata(): Os2Table {
    const os2 = this.tableManager.os2
    return { ...os2, panose: os2.panose.slice() }
  }

  /** Embedding and subsetting permissions encoded by OS/2.fsType. */
  get embeddingPermissions(): FontEmbeddingPermissions {
    const os2 = this.tableManager.os2
    const fsType = os2.fsType
    const usage = fsType & 0x000E
    const level = (usage & 0x0008) !== 0
        ? 'editable'
        : (usage & 0x0004) !== 0
          ? 'preview-print'
          : (usage & 0x0002) !== 0
            ? 'restricted'
            : 'installable'
    return {
      level,
      noSubsetting: (fsType & 0x0100) !== 0,
      bitmapOnly: (fsType & 0x0200) !== 0,
    }
  }

  /** Version-5 optical-style range in points; null means no optical-style range. */
  get opticalSizeRange(): FontOpticalSizeRange | null {
    const os2 = this.tableManager.os2
    if (os2.version < 5 || (os2.lowerOpticalPointSize === 0 && os2.upperOpticalPointSize === 0xFFFF)) return null
    return {
      lowerInclusive: os2.lowerOpticalPointSize / 20,
      upperExclusive: os2.upperOpticalPointSize === 0xFFFF ? null : os2.upperOpticalPointSize / 20,
    }
  }

  /**
   * Complete GSUB/GPOS FeatureList metadata at the current variation instance,
   * including registered size, stylistic-set and character-variant parameters.
   */
  getOpenTypeLayoutFeatures(table?: 'GSUB' | 'GPOS'): readonly FontOpenTypeLayoutFeature[] {
    const result: FontOpenTypeLayoutFeature[] = []
    const coordinates = this.tableManager.normalizedCoords
    if (table === undefined || table === 'GSUB') {
      const gsub = this.tableManager.gsub
      if (gsub !== null) appendOpenTypeLayoutFeatures(result, 'GSUB', gsub.getFeatureRecords(coordinates))
    }
    if (table === undefined || table === 'GPOS') {
      const gpos = this.tableManager.gpos
      if (gpos !== null) appendOpenTypeLayoutFeatures(result, 'GPOS', gpos.getFeatureRecords(coordinates))
    }
    return result
  }

  supportsUnicodeRange(bit: number): boolean {
    if (!Number.isInteger(bit) || bit < 0 || bit > 127) throw new Error(`OS/2 Unicode-range bit must be an integer from 0 to 127, got ${bit}`)
    const os2 = this.tableManager.os2
    const word = bit < 32 ? os2.unicodeRange1 : bit < 64 ? os2.unicodeRange2 : bit < 96 ? os2.unicodeRange3 : os2.unicodeRange4
    return (word & (1 << (bit & 31))) !== 0
  }

  supportsCodePageRange(bit: number): boolean {
    if (!Number.isInteger(bit) || bit < 0 || bit > 63) throw new Error(`OS/2 code-page-range bit must be an integer from 0 to 63, got ${bit}`)
    const os2 = this.tableManager.os2
    const word = bit < 32 ? os2.codePageRange1 : os2.codePageRange2
    return (word & (1 << (bit & 31))) !== 0
  }

  /** Font metrics */
  get metrics(): FontMetrics {
    if (!this.metricsCache) {
      this.metricsCache = this.buildMetrics()
    }
    return this.metricsCache
  }

  /** Direct access to the cmap table */
  get cmap(): CmapTable {
    return this.tableManager.cmap
  }

  /** Whether the font carries a 'cmap' table (embedded PDF subsets often omit it). */
  get hasCmap(): boolean {
    return this.tableManager.hasCmap
  }

  /** Number of glyphs */
  get numGlyphs(): number {
    return this.tableManager.maxp.numGlyphs
  }

  /**
   * Gets the glyphId for a Unicode codepoint
   */
  getGlyphId(codePoint: number): number {
    const cmap = this.tableManager.cmap
    const glyphId = cmap.getGlyphId(codePoint)
    if (glyphId !== 0) return glyphId

    // Windows symbol cmaps store a one-byte character repertoire in the PUA.
    // Legacy symbol text maps byte 0x20 to OS/2.usFirstCharIndex and preserves
    // the following byte offsets. This conversion belongs at the Font boundary
    // because it requires both cmap selection and OS/2 metadata.
    const selected = cmap.selectedEncoding
    if (selected.platformId === 3 && selected.encodingId === 0 &&
        codePoint >= 0x20 && codePoint <= 0xFF) {
      const symbolCode = this.tableManager.os2.firstCharIndex + codePoint - 0x20
      if (symbolCode <= 0xFFFF) return cmap.getGlyphId(symbolCode)
    }
    return 0
  }

  /**
   * Gets Glyph data for a glyphId (cached)
   */
  getGlyph(glyphId: number): Glyph {
    let glyph = this.glyphCache.get(glyphId)
    if (!glyph) {
      const accent = this.tableManager.acnt?.getAttachment(glyphId) ?? null
      glyph = accent === null
        ? this.tableManager.getGlyphOutline(glyphId)
        : this.buildAccentGlyph(glyphId, accent)
      this.glyphCache.set(glyphId, glyph)
    }
    return glyph
  }

  private buildAccentGlyph(glyphId: number, attachment: AcntGlyphAttachment): Glyph {
    const primary = this.getGlyph(attachment.primaryGlyphIndex)
    let commandCount = primary.outline.commands.length
    let coordinateCount = primary.outline.coords.length
    const secondaryGlyphs = new Array<Glyph>(attachment.components.length)
    const translations = new Array<{ x: number, y: number }>(attachment.components.length)
    for (let i = 0; i < attachment.components.length; i++) {
      const component = attachment.components[i]!
      const secondary = this.getGlyph(component.secondaryGlyphIndex)
      const primaryPoint = this.getGlyphControlPoint(attachment.primaryGlyphIndex, component.primaryAttachmentPoint)
      const secondaryPoint = this.getGlyphControlPoint(component.secondaryGlyphIndex, component.secondaryGlyphAttachmentNumber)
      secondaryGlyphs[i] = secondary
      translations[i] = { x: primaryPoint.x - secondaryPoint.x, y: primaryPoint.y - secondaryPoint.y }
      commandCount += secondary.outline.commands.length
      coordinateCount += secondary.outline.coords.length
    }

    const commands = new Uint8Array(commandCount)
    const coords = new Float32Array(coordinateCount)
    commands.set(primary.outline.commands)
    coords.set(primary.outline.coords)
    let commandOffset = primary.outline.commands.length
    let coordinateOffset = primary.outline.coords.length
    for (let i = 0; i < secondaryGlyphs.length; i++) {
      const secondary = secondaryGlyphs[i]!
      const translation = translations[i]!
      commands.set(secondary.outline.commands, commandOffset)
      for (let j = 0; j < secondary.outline.coords.length; j += 2) {
        coords[coordinateOffset + j] = secondary.outline.coords[j]! + translation.x
        coords[coordinateOffset + j + 1] = secondary.outline.coords[j + 1]! + translation.y
      }
      commandOffset += secondary.outline.commands.length
      coordinateOffset += secondary.outline.coords.length
    }

    let xMin = 0, yMin = 0, xMax = 0, yMax = 0
    if (coords.length > 0) {
      xMin = xMax = coords[0]!
      yMin = yMax = coords[1]!
      for (let i = 2; i < coords.length; i += 2) {
        const x = coords[i]!, y = coords[i + 1]!
        if (x < xMin) xMin = x
        if (x > xMax) xMax = x
        if (y < yMin) yMin = y
        if (y > yMax) yMax = y
      }
    }
    return {
      glyphId,
      outline: { commands, coords },
      advanceWidth: primary.advanceWidth,
      lsb: primary.lsb,
      xMin, yMin, xMax, yMax,
    }
  }

  getGlyphBoundingBox(glyphId: number): { xMin: number, yMin: number, xMax: number, yMax: number } {
    if ((this.tableManager.acnt?.getAttachment(glyphId) ?? null) !== null) {
      const glyph = this.getGlyph(glyphId)
      return { xMin: glyph.xMin, yMin: glyph.yMin, xMax: glyph.xMax, yMax: glyph.yMax }
    }
    const glyfReader = getTableReader(this.tableManager.sfnt, 'glyf')
    if (glyfReader !== null && this.tableManager.normalizedCoords === null) {
      const offset = this.tableManager.loca.getOffset(glyphId)
      const length = this.tableManager.loca.getLength(glyphId)
      if (length >= 10) {
        const reader = glyfReader.subReader(offset, length)
        reader.skip(2)
        return {
          xMin: reader.readInt16(),
          yMin: reader.readInt16(),
          xMax: reader.readInt16(),
          yMax: reader.readInt16(),
        }
      }
    }
    const glyph = this.getGlyph(glyphId)
    return { xMin: glyph.xMin, yMin: glyph.yMin, xMax: glyph.xMax, yMax: glyph.yMax }
  }

  /**
   * Gets a glyph with hinting applied
   * CFF fonts: applies stem hints + blue zone snapping
   * TrueType fonts: runs fpgm/prep/glyph instructions through the bytecode
   * interpreter (gasp gates grid-fitting per ppem; variable fonts use the
   * cvar-varied CVT)
   * When hinting does not apply at this ppem: returns the plain glyph
   *
   * @param glyphId Glyph ID
   * @param ppem Pixel size (pixels per em)
   */
  getHintedGlyph(glyphId: number, ppem: number, horizontalPpem = ppem): Glyph {
    if (ppem <= 0 || horizontalPpem <= 0) return this.getGlyph(glyphId)

    // CFF font case
    if (this.isCff) {
      if (this.isCff2) {
        const cff2 = this.tableManager.cff2
        if (cff2 === null) throw new Error("CFF2 table not found in OTF font")
        const coords = this.tableManager.normalizedCoords
          ?? new Array<number>(this.tableManager.fvar?.axes.length ?? 0).fill(0)
        const { outline, hints, privateDictEntries } = parseCff2GlyphWithHints(cff2, glyphId, coords)
        if (hints.hStems.length === 0 && hints.vStems.length === 0) {
          return this.withDeviceAdvance({ ...this.getGlyph(glyphId), advanceWidth: this.getAdvanceWidth(glyphId) }, horizontalPpem)
        }
        const hintedOutline = applyCffHints(
          outline, hints, extractCffHintParams(privateDictEntries), ppem, this.metrics.unitsPerEm,
        )
        return this.withDeviceAdvance(this.buildHintedGlyph(glyphId, hintedOutline), horizontalPpem)
      }
      const cff = this.tableManager.cff
      if (cff === null) throw new Error("CFF table not found in OTF font")

      const { outline, hints, privateDictEntries } = parseCffGlyphWithHints(cff, glyphId)

      // No hints present: the plain outline is already exact
      if (hints.hStems.length === 0 && hints.vStems.length === 0) {
        return this.withDeviceAdvance(this.getGlyph(glyphId), horizontalPpem)
      }

      const params = extractCffHintParams(privateDictEntries)
      const hintedOutline = applyCffHints(
        outline, hints, params, ppem, this.metrics.unitsPerEm,
      )

      return this.withDeviceAdvance(this.buildHintedGlyph(glyphId, hintedOutline), horizontalPpem)
    }

    // TrueType: bytecode interpreter grid-fitting. This gate is kept here so
    // variable-font MVAR gsp0..gsp9 deltas affect the same decision as callers
    // of getDeviceMetrics.
    const hinter = this.getTtHinter()
    if (!hinter) return this.withDeviceAdvance(this.getGlyph(glyphId), horizontalPpem)

    const key = `${glyphId}|${ppem}|${horizontalPpem}`
    const cached = this.hintedGlyphCache.get(key)
    if (cached) return cached

    const hinted = hinter.getHintedGlyph(glyphId, ppem, horizontalPpem)
    if (!hinted) return this.withDeviceAdvance(this.getGlyph(glyphId), horizontalPpem)

    const glyph = this.withDeviceAdvance(this.buildHintedGlyph(glyphId, hinted.outline, hinted.advanceWidth, hinted.bounds), horizontalPpem)
    this.hintedGlyphCache.set(key, glyph)
    return glyph
  }

  /** Exact TrueType grid-fitted point and scan-control state in F26Dot6 device pixels. */
  getTrueTypeHintingState(glyphId: number, ppem: number, transform: TrueTypeHintingTransform = {}): TrueTypeHintingState | null {
    if (!Number.isInteger(glyphId) || glyphId < 0 || glyphId >= this.numGlyphs) {
      throw new RangeError(`Glyph ID ${glyphId} is outside 0..${this.numGlyphs - 1}`)
    }
    return this.getTtHinter()?.getHintingState(glyphId, ppem, transform) ?? null
  }

  /** Monochrome TrueType scan conversion with the glyph's SCANCTRL/SCANTYPE state. */
  rasterizeTrueTypeGlyph(glyphId: number, ppem: number, transform: TrueTypeHintingTransform = {}): TrueTypeRasterBitmap | null {
    const state = this.getTrueTypeHintingState(glyphId, ppem, transform)
    return state === null ? null : rasterizeTrueTypeHintingState(state, ppem, transform)
  }

  private withDeviceAdvance(glyph: Glyph, ppem: number): Glyph {
    const pixelWidth = this.getDeviceAdvanceWidth(glyph.glyphId, ppem)
    if (pixelWidth === null) return glyph
    return { ...glyph, advanceWidth: pixelWidth * this.metrics.unitsPerEm / ppem }
  }

  /** Builds a Glyph record around a hinted outline (bbox recomputed) */
  private buildHintedGlyph(
    glyphId: number,
    outline: Glyph['outline'],
    hintedAdvanceWidth?: number,
    exactBounds?: { xMin: number, yMin: number, xMax: number, yMax: number },
  ): Glyph {
    const advanceWidth = hintedAdvanceWidth ?? this.getAdvanceWidth(glyphId)
    const { xMin, yMin, xMax, yMax } = exactBounds ?? getExactOutlineBounds(outline)
    return {
      glyphId,
      advanceWidth,
      lsb: 0,
      outline,
      xMin, yMin, xMax, yMax,
    }
  }

  /** Lazily builds the TrueType grid-fitting engine for the current variation state */
  private getTtHinter(): TrueTypeGlyphHinter | null {
    if (this.ttHinter !== undefined) return this.ttHinter

    const tm = this.tableManager
    const glyfReader = getTableReader(tm.sfnt, 'glyf')
    if (!glyfReader) {
      this.ttHinter = null
      return null
    }

    const coords = tm.normalizedCoords
    const cvt = tm.cvt
    let cvtDeltas: number[] | null = null
    if (coords && cvt) {
      const cvar = tm.cvar
      if (cvar) cvtDeltas = cvar.getCvtDeltas(coords, cvt.length)
    }

    this.ttHinter = new TrueTypeGlyphHinter({
      glyfReader,
      loca: tm.loca,
      cvt,
      cvtDeltas,
      fpgm: tm.fpgm?.bytecode ?? null,
      prep: tm.prep?.bytecode ?? null,
      gvar: coords ? tm.gvar : null,
      coords,
      unitsPerEm: tm.head.unitsPerEm,
      maxp: tm.maxp,
      gasp: tm.gasp,
      getAdvanceWidth: this.getAdvanceWidthBound,
      getLeftSideBearing: this.getLeftSideBearingBound,
      getAdvanceHeight: this.getAdvanceHeightBound,
      getTopSideBearing: this.getTopSideBearingBound,
      backwardCompatibility: true,
    })
    return this.ttHinter
  }

  /** Bound advance width lookup for the hinter (avoids per-call closures) */
  private readonly getAdvanceWidthBound = (glyphId: number): number => this.getAdvanceWidth(glyphId)
  private readonly getLeftSideBearingBound = (glyphId: number): number => this.getLeftSideBearing(glyphId)
  private readonly getAdvanceHeightBound = (glyphId: number): number => this.getAdvanceHeight(glyphId)
  private readonly getTopSideBearingBound = (glyphId: number): number => this.getTopSideBearing(glyphId)

  /**
   * Gets Glyph data for a Unicode codepoint
   */
  getGlyphByCodePoint(codePoint: number): Glyph {
    const glyphId = this.getGlyphId(codePoint)
    return this.getGlyph(glyphId)
  }

  /**
   * Gets the array of glyphIds for all codepoints in a string
   */
  getGlyphIds(text: string): number[] {
    const ids: number[] = []
    for (const char of text) {
      const cp = char.codePointAt(0)!
      ids.push(this.getGlyphId(cp))
    }
    return ids
  }

  /**
   * Gets the advanceWidth (font units) for a glyphId
   */
  getAdvanceWidth(glyphId: number): number {
    // Bitmap-only fonts (no 'hhea'/'hmtx', e.g. macOS NISC18030) take advances
    // from the embedded-bitmap glyph metrics instead.
    if (!this.tableManager.hasHorizontalMetrics) {
      return this.getBitmapAdvanceWidth(glyphId)
    }
    const metricsGlyphId = this.getTrueTypeMetricsGlyphId(glyphId)
    let width = this.tableManager.hmtx.getAdvanceWidth(metricsGlyphId)
    const coords = this.tableManager.normalizedCoords
    if (coords) {
      const hvar = this.tableManager.hvar
      if (hvar) {
        width += hvar.getAdvanceWidthDelta(glyphId, coords)
      } else if (this.tableManager.gvar !== null && getTableReader(this.tableManager.sfnt, 'glyf') !== null) {
        // Before HVAR was introduced, variable TrueType fonts encoded advance
        // changes in gvar's horizontal phantom points. The parsed glyph already
        // resolves USE_MY_METRICS and PP1/PP2 deltas for the active instance.
        width = this.getGlyph(glyphId).advanceWidth
      }
    }
    return width
  }

  /** Horizontal left side bearing with HVAR or gvar variation applied. */
  getLeftSideBearing(glyphId: number): number {
    if (!this.tableManager.hasHorizontalMetrics) return 0
    const metricsGlyphId = this.getTrueTypeMetricsGlyphId(glyphId)
    const coords = this.tableManager.normalizedCoords
    if (coords !== null) {
      const hvar = this.tableManager.hvar
      if (hvar !== null && hvar.hasLsbMapping) {
        return this.tableManager.hmtx.getLsb(metricsGlyphId) + hvar.getLsbDelta(glyphId, coords)
      }
      if (this.tableManager.gvar !== null && getTableReader(this.tableManager.sfnt, 'glyf') !== null) {
        // Variable TrueType fonts require default LSB=xMin; without an HVAR
        // side-bearing map the varied outline therefore supplies the LSB.
        const bearing = Math.round(this.getTrueTypeVariationMetrics(glyphId).xMin)
        return bearing === 0 ? 0 : bearing
      }
    }
    return this.tableManager.hmtx.getLsb(metricsGlyphId)
  }

  /** Horizontal right side bearing with HVAR or gvar variation applied. */
  getRightSideBearing(glyphId: number): number {
    if (!this.tableManager.hasHorizontalMetrics) return 0
    const coords = this.tableManager.normalizedCoords
    if (coords !== null) {
      const hvar = this.tableManager.hvar
      if (hvar !== null && hvar.hasRsbMapping) {
        const metricsGlyphId = this.getTrueTypeMetricsGlyphId(glyphId)
        const base = this.tableManager.hmtx.getAdvanceWidth(metricsGlyphId)
          - this.tableManager.hmtx.getLsb(metricsGlyphId) - this.getDefaultGlyphWidth(glyphId)
        const bearing = base + hvar.getRsbDelta(glyphId, coords)
        return bearing === 0 ? 0 : bearing
      }
      if (this.tableManager.gvar !== null && getTableReader(this.tableManager.sfnt, 'glyf') !== null) {
        const metrics = this.getTrueTypeVariationMetrics(glyphId)
        const bearing = Math.round(this.getAdvanceWidth(glyphId)) - Math.round(metrics.xMax)
        return bearing === 0 ? 0 : bearing
      }
    }
    const glyph = this.getGlyph(glyphId)
    return this.getAdvanceWidth(glyphId)
      - this.getLeftSideBearing(glyphId) - (glyph.xMax - glyph.xMin)
  }

  /** Resolves the hmtx owner selected by a glyf composite's USE_MY_METRICS flag. */
  private getTrueTypeMetricsGlyphId(glyphId: number): number {
    const cached = this.trueTypeMetricsGlyphCache.get(glyphId)
    if (cached !== undefined) return cached
    const glyfReader = getTableReader(this.tableManager.sfnt, 'glyf')
    if (glyfReader === null) return glyphId
    const glyphLength = this.tableManager.loca.getLength(glyphId)
    if (glyphLength < 10) return glyphId
    const glyphReader = glyfReader.subReader(this.tableManager.loca.getOffset(glyphId), glyphLength)
    if (glyphReader.readInt16() >= 0) {
      this.trueTypeMetricsGlyphCache.set(glyphId, glyphId)
      return glyphId
    }
    const composed = composeGlyphPoints(
      glyfReader, this.tableManager.loca, glyphId, null, null, this.tableManager.glyphPhantomPointProvider,
    )
    this.trueTypeMetricsGlyphCache.set(glyphId, composed.metricsGlyphId)
    return composed.metricsGlyphId
  }

  /**
   * Derives an advance width (font units) from embedded-bitmap glyph metrics for
   * fonts that ship no horizontal metrics table. The strike's horiAdvance is in
   * pixels at the strike ppem, so it is scaled to font units by unitsPerEm/ppem.
   */
  private getBitmapAdvanceWidth(glyphId: number): number {
    const unitsPerEm = this.tableManager.head.unitsPerEm
    type BitmapDataTable = {
      readonly availableStrikes: readonly BitmapSizeRecord[]
      getGlyphBitmap(gid: number, ppem: number): { format: number, metrics: BitmapMetrics } | null
    }
    const sources: [ 'EBLC' | 'bloc' | 'CBLC', BitmapDataTable | null ][] = [
      ['EBLC', this.tableManager.ebdt],
      ['bloc', this.tableManager.bdat],
      ['CBLC', this.tableManager.cbdt],
    ]
    for (const [locTag, data] of sources) {
      if (!data) continue
      // The full strike records (with index-subtable offsets) come from the
      // location table, not the data table's lightweight ppem list.
      const strikes = data.availableStrikes
      if (strikes.length === 0) continue
      const strike = strikes[0]!
      if (strike.ppemY === 0) continue
      const glyph = data.getGlyphBitmap(glyphId, strike.ppemY)
      if (!glyph) continue
      const horiAdvance = glyph.metrics.horiAdvance
      return Math.round((horiAdvance * unitsPerEm) / strike.ppemY)
    }
    return 0
  }

  /**
   * Gets the kerning value between two glyphs (font units)
   * Prefers GPOS, then AAT kerx, then the legacy kern table.
   */
  getKerning(leftGlyphId: number, rightGlyphId: number): number {
    const gpos = this.tableManager.gpos
    if (gpos) {
      const val = gpos.getKerning(leftGlyphId, rightGlyphId)
      if (val !== 0) return val
    }
    const kerx = this.tableManager.kerx
    const normalizedCoords = this.tableManager.normalizedCoords
    const tupleScalars = normalizedCoords !== null && this.tableManager.gvar !== null
      ? this.tableManager.gvar.getSharedTupleScalars(normalizedCoords)
      : undefined
    if (kerx) {
      const val = kerx.getKerning(leftGlyphId, rightGlyphId, tupleScalars)
      if (val !== 0) return val
    }
    const kern = this.tableManager.kern
    return kern ? kern.getKerning(leftGlyphId, rightGlyphId, tupleScalars) : 0
  }

  /**
   * Generates a subset font containing only the glyphs used by the given text
   * @param text Text to subset for
   * @param extraGlyphIds Additional glyph IDs to include (e.g. variant glyphs not in cmap)
   * @returns Subset font binary (SFNT-wrapped)
   */
  subset(text: string, extraGlyphIds?: Iterable<number>): ArrayBuffer {
    return this.subsetWithMapping(text, extraGlyphIds).buffer
  }

  /**
   * Generates a subset font containing only the glyphs used by the given text (with GID mapping)
   * @param text Text to subset for
   * @param extraGlyphIds Additional glyph IDs to include (e.g. variant glyphs not in cmap)
   * @returns Subset result (font binary + GID mapping)
   */
  subsetWithMapping(text: string, extraGlyphIds?: Iterable<number>): SubsetResult {
    const codePointToGlyphId = new Map<number, number>()
    const glyphIds = new Set<number>()
    collectTextSubsetGlyphs(this, text, glyphIds, codePointToGlyphId)

    if (extraGlyphIds) {
      for (const gid of extraGlyphIds) {
        glyphIds.add(gid)
      }
    }

    this.assertSubsetPermission(glyphIds)
    if (this.tableManager.isCff2) return this.subsetCff2ByGlyphIds(glyphIds, codePointToGlyphId)
    return subsetFont(this.tableManager.sfnt, glyphIds, codePointToGlyphId, this.tableManager.normalizedCoords)
  }

  /**
   * Generates a general-purpose subset while preserving glyph IDs and all
   * glyph-indexed layout, color, variation, vertical, math, and SVG tables.
   * Unlike {@link subsetWithMapping}, variable-font coordinates are not baked.
   */
  subsetPreservingTables(text: string, extraGlyphIds?: Iterable<number>): SubsetResult {
    const codePointToGlyphId = new Map<number, number>()
    const glyphIds = new Set<number>()
    collectTextSubsetGlyphs(this, text, glyphIds, codePointToGlyphId)
    if (extraGlyphIds !== undefined) {
      for (const glyphId of extraGlyphIds) glyphIds.add(glyphId)
    }
    this.assertSubsetPermission(glyphIds)
    return subsetFontPreservingTables(this.tableManager.sfnt, glyphIds, codePointToGlyphId)
  }

  /**
   * Subsets every face in this TTC/OTC resource and rebuilds the collection.
   * Each entry supplies the text used by the face at the same collection index.
   */
  subsetCollection(textByFont: readonly string[]): ArrayBuffer {
    const collection = this.tableManager.sfnt.collection
    if (collection === undefined) throw new Error('Font is not part of a TTC/OTC collection')
    if (textByFont.length !== collection.numFonts) {
      throw new Error(`Collection subset requires ${collection.numFonts} text entries, got ${textByFont.length}`)
    }
    const subsets = new Array<ArrayBuffer>(collection.numFonts)
    for (let fontIndex = 0; fontIndex < collection.numFonts; fontIndex++) {
      subsets[fontIndex] = this.getCollectionFont(fontIndex).subset(textByFont[fontIndex]!)
    }
    return buildFontCollection(subsets, { majorVersion: collection.majorVersion })
  }

  /**
   * Generates a subset font containing only the given glyph IDs (with GID mapping)
   * @param glyphIds Glyph IDs to include in the subset
   * @param codePointToGlyphId Mapping from codepoint to glyphId
   * @returns Subset result (font binary + old GID → new GID mapping)
   */
  subsetByGlyphIds(glyphIds: Set<number>, codePointToGlyphId?: Map<number, number>): SubsetResult {
    this.assertSubsetPermission(glyphIds)
    if (this.tableManager.isCff2) return this.subsetCff2ByGlyphIds(glyphIds, codePointToGlyphId)
    return subsetFont(
      this.tableManager.sfnt, glyphIds, codePointToGlyphId,
      this.tableManager.normalizedCoords,
    )
  }

  private assertSubsetPermission(glyphIds: ReadonlySet<number>): void {
    const permissions = this.embeddingPermissions
    if (permissions.level === 'restricted') throw new Error('OS/2 fsType prohibits font embedding and subsetting')
    if (permissions.bitmapOnly) throw new Error('OS/2 fsType permits only embedded bitmap data')
    if (permissions.noSubsetting) {
      if (glyphIds.size !== this.numGlyphs) throw new Error('OS/2 fsType requires the complete font without subsetting')
      for (let glyphId = 0; glyphId < this.numGlyphs; glyphId++) {
        if (!glyphIds.has(glyphId)) throw new Error('OS/2 fsType requires the complete font without subsetting')
      }
    }
  }

  /**
   * Subset a CFF2 (variable) font for PDF embedding: interpret each glyph's
   * CFF2 charstring at the current instance (normalizedCoords) to a plain
   * outline, then re-encode those outlines as a static CID-keyed CFF
   * (CIDFontType0C). The embedded outlines are exactly what the rasteriser
   * draws, so preview and print agree. Glyph 0 (.notdef) is always included
   * and mapped to new GID 0.
   */
  private subsetCff2ByGlyphIds(glyphIds: Set<number>, codePointToGlyphId?: Map<number, number>): SubsetResult {
    const expandedGlyphIds = collectFontGlyphReferences(this.tableManager.sfnt, glyphIds)
    const oldGids = [0, ...[...expandedGlyphIds].filter(g => g !== 0).sort((a, b) => a - b)]
    const oldToNew = new Map<number, number>()
    const outlineGlyphs: OutlineGlyph[] = []
    const horizontalMetrics = new Map<number, { advanceWidth: number, leftSideBearing: number }>()
    let xMin = Infinity
    let yMin = Infinity
    let xMax = -Infinity
    let yMax = -Infinity
    for (let i = 0; i < oldGids.length; i++) {
      const gid = oldGids[i]!
      oldToNew.set(gid, i)
      const glyph = this.getGlyph(gid)
      const advanceWidth = this.getAdvanceWidth(gid)
      outlineGlyphs.push({ outline: glyph.outline, advanceWidth })
      horizontalMetrics.set(gid, { advanceWidth, leftSideBearing: this.getLeftSideBearing(gid) })
      if (glyph.xMin < xMin) xMin = glyph.xMin
      if (glyph.yMin < yMin) yMin = glyph.yMin
      if (glyph.xMax > xMax) xMax = glyph.xMax
      if (glyph.yMax > yMax) yMax = glyph.yMax
    }
    const bbox = Number.isFinite(xMin)
      ? { xMin: Math.round(xMin), yMin: Math.round(yMin), xMax: Math.round(xMax), yMax: Math.round(yMax) }
      : null
    const scale = 1000 / this.metrics.unitsPerEm
    const fontMatrix = [scale / 1000, 0, 0, scale / 1000, 0, 0]
    const cidKeyedCff = buildCidCffFromOutlines(outlineGlyphs, bbox, fontMatrix)
    const buffer = buildCffSfntWrapper(
      this.tableManager.sfnt, this.tableManager, cidKeyedCff,
      oldToNew, oldGids.length, codePointToGlyphId, horizontalMetrics,
    )
    return { buffer, oldToNewGlyphId: oldToNew, cidKeyedCff }
  }

  /**
   * Gets the vertical advance height (font units)
   * Returns unitsPerEm if the vmtx table is absent
   */
  getAdvanceHeight(glyphId: number): number {
    const vmtx = this.tableManager.vmtx
    let height = vmtx ? vmtx.getAdvanceHeight(glyphId) : this.tableManager.head.unitsPerEm
    const coords = this.tableManager.normalizedCoords
    if (coords) {
      const vvar = this.tableManager.vvar
      if (vvar) {
        height += vvar.getAdvanceHeightDelta(glyphId, coords)
      } else {
        height += this.getTrueTypeVariationMetrics(glyphId).advanceHeightDelta
      }
    }
    return height
  }

  /** Vertical top side bearing with VVAR variation applied. */
  getTopSideBearing(glyphId: number): number {
    const vmtx = this.tableManager.vmtx
    if (vmtx === null) return 0
    let bearing = vmtx.getTopSideBearing(glyphId)
    const coords = this.tableManager.normalizedCoords
    const vvar = coords === null ? null : this.tableManager.vvar
    if (vvar !== null && coords !== null && vvar.hasTsbMapping) bearing += vvar.getTsbDelta(glyphId, coords)
    else if (coords !== null) {
      const metrics = this.getTrueTypeVariationMetrics(glyphId)
      const delta = metrics.verticalOriginDelta
      if (delta !== 0 || this.tableManager.gvar !== null) {
        const defaultOrigin = this.getDefaultGlyphYMax(glyphId) + bearing
        bearing = defaultOrigin + delta - metrics.yMax
      }
    }
    return bearing
  }

  /** Vertical bottom side bearing with VVAR variation applied. */
  getBottomSideBearing(glyphId: number): number {
    const vmtx = this.tableManager.vmtx
    if (vmtx === null) return 0
    let bearing = vmtx.getAdvanceHeight(glyphId) - vmtx.getTopSideBearing(glyphId) - this.getDefaultGlyphHeight(glyphId)
    const coords = this.tableManager.normalizedCoords
    const vvar = coords === null ? null : this.tableManager.vvar
    if (vvar !== null && coords !== null && vvar.hasBsbMapping) bearing += vvar.getBsbDelta(glyphId, coords)
    else if (coords !== null && this.tableManager.gvar !== null) {
      const metrics = this.getTrueTypeVariationMetrics(glyphId)
      bearing = this.getAdvanceHeight(glyphId) - this.getTopSideBearing(glyphId) - (metrics.yMax - metrics.yMin)
    }
    return bearing
  }

  private getTrueTypeVariationMetrics(glyphId: number): {
    advanceHeightDelta: number
    verticalOriginDelta: number
    xMin: number
    xMax: number
    yMin: number
    yMax: number
  } {
    const cached = this.trueTypeVariationMetricsCache.get(glyphId)
    if (cached !== undefined) return cached
    const coords = this.tableManager.normalizedCoords
    const gvar = this.tableManager.gvar
    const glyfReader = getTableReader(this.tableManager.sfnt, 'glyf')
    let value = { advanceHeightDelta: 0, verticalOriginDelta: 0, xMin: 0, xMax: 0, yMin: 0, yMax: 0 }
    if (coords !== null && gvar !== null && glyfReader !== null) {
      const composed = composeGlyphPoints(
        glyfReader, this.tableManager.loca, glyphId, gvar, coords, this.tableManager.glyphPhantomPointProvider,
      )
      let xMin = 0, xMax = 0, yMin = 0, yMax = 0
      if (composed.numPoints > 0) {
        xMin = xMax = composed.xCoords[0]!
        yMin = yMax = composed.yCoords[0]!
        for (let i = 1; i < composed.numPoints; i++) {
          const x = composed.xCoords[i]!
          const y = composed.yCoords[i]!
          if (x < xMin) xMin = x
          if (x > xMax) xMax = x
          if (y < yMin) yMin = y
          if (y > yMax) yMax = y
        }
      }
      value = {
        advanceHeightDelta: Math.round(composed.advanceHeightDelta),
        verticalOriginDelta: Math.round(composed.verticalOriginDelta),
        xMin,
        xMax,
        yMin,
        yMax,
      }
    }
    this.trueTypeVariationMetricsCache.set(glyphId, value)
    return value
  }

  private getDefaultGlyphYMax(glyphId: number): number {
    const cached = this.defaultTrueTypeYMaxCache.get(glyphId)
    if (cached !== undefined) return cached
    const glyfReader = getTableReader(this.tableManager.sfnt, 'glyf')
    if (glyfReader !== null) {
      const composed = composeGlyphPoints(
        glyfReader, this.tableManager.loca, glyphId, null, null, this.tableManager.glyphPhantomPointProvider,
      )
      let yMax = 0
      if (composed.yCoords.length > 0) {
        yMax = composed.yCoords[0]!
        for (let i = 1; i < composed.yCoords.length; i++) {
          if (composed.yCoords[i]! > yMax) yMax = composed.yCoords[i]!
        }
      }
      this.defaultTrueTypeYMaxCache.set(glyphId, yMax)
      return yMax
    }
    const glyph = this.getGlyph(glyphId)
    return glyph.yMax
  }

  private getDefaultGlyphHeight(glyphId: number): number {
    const glyfReader = getTableReader(this.tableManager.sfnt, 'glyf')
    if (glyfReader !== null) {
      const offset = this.tableManager.loca.getOffset(glyphId)
      const length = this.tableManager.loca.getLength(glyphId)
      if (length < 10) return 0
      const reader = glyfReader.subReader(offset, length)
      reader.skip(4)
      const yMin = reader.readInt16()
      reader.skip(2)
      return reader.readInt16() - yMin
    }
    const cff2 = this.tableManager.cff2
    if (cff2 !== null) {
      const axisCount = this.tableManager.fvar?.axes.length ?? 0
      const outline = parseCff2Glyph(cff2, glyphId, new Array<number>(axisCount).fill(0)).outline
      if (outline.coords.length === 0) return 0
      let yMin = outline.coords[1]!
      let yMax = yMin
      for (let i = 3; i < outline.coords.length; i += 2) {
        const y = outline.coords[i]!
        if (y < yMin) yMin = y
        if (y > yMax) yMax = y
      }
      return yMax - yMin
    }
    const glyph = this.getGlyph(glyphId)
    return glyph.yMax - glyph.yMin
  }

  private getDefaultGlyphWidth(glyphId: number): number {
    const glyfReader = getTableReader(this.tableManager.sfnt, 'glyf')
    if (glyfReader !== null) {
      const offset = this.tableManager.loca.getOffset(glyphId)
      const length = this.tableManager.loca.getLength(glyphId)
      if (length < 10) return 0
      const reader = glyfReader.subReader(offset, length)
      reader.skip(2)
      const xMin = reader.readInt16()
      reader.skip(2)
      return reader.readInt16() - xMin
    }
    const cff2 = this.tableManager.cff2
    if (cff2 !== null) {
      const axisCount = this.tableManager.fvar?.axes.length ?? 0
      const outline = parseCff2Glyph(cff2, glyphId, new Array<number>(axisCount).fill(0)).outline
      if (outline.coords.length === 0) return 0
      let xMin = outline.coords[0]!
      let xMax = xMin
      for (let i = 2; i < outline.coords.length; i += 2) {
        const x = outline.coords[i]!
        if (x < xMin) xMin = x
        if (x > xMax) xMax = x
      }
      return xMax - xMin
    }
    const glyph = this.getGlyph(glyphId)
    return glyph.xMax - glyph.xMin
  }

  /**
   * Gets the Vertical Origin Y of a glyph (font units)
   * Priority: VORG → vmtx top side bearing (originY = yMax + tsb) → ascender
   */
  getVerticalOrigin(glyphId: number): number {
    const vorg = this.tableManager.vorg
    const cff2 = this.tableManager.cff2
    if (vorg !== null && (this.tableManager.cff !== null || cff2 !== null)) {
      const coords = this.tableManager.normalizedCoords
      const candidate = cff2 !== null && coords !== null ? this.tableManager.vvar : null
      const vvar = candidate !== null && candidate.hasVOrgMapping ? candidate : null
      return vorg.getVertOriginY(glyphId) + (vvar?.getVOrgDelta(glyphId, coords!) ?? 0)
    }
    const vmtx = this.tableManager.vmtx
    if (vmtx) {
      // Per the OpenType vmtx specification the top side bearing is the
      // distance from the vertical origin to the top of the glyph bounding box
      return this.getGlyph(glyphId).yMax + this.getTopSideBearing(glyphId)
    }
    return this.metrics.ascender
  }

  /**
   * Gets a bitmap glyph (checks sbix → CBDT → EBDT in order)
   * @param glyphId Glyph ID
   * @param ppem Pixel size
   * @returns Bitmap data or null
   */
  getBitmapGlyph(glyphId: number, ppemY: number, ppemX = ppemY, ppi?: number): BitmapGlyphData | null {
    const sbixResult = this.resolveSbixGlyph(glyphId, ppemY, ppi)
    if (sbixResult !== null) {
      const result = sbixResult.glyph
      return { data: result.data, format: 0, metrics: { height: 0, width: 0, horiBearingX: result.originOffsetX, horiBearingY: result.originOffsetY, horiAdvance: 0, vertBearingX: 0, vertBearingY: 0, vertAdvance: 0 } }
    }
    const substitute = this.tableManager.ebsc?.getSubstitutePpem(ppemX, ppemY)
    const sourceX = substitute?.substitutePpemX ?? ppemX
    const sourceY = substitute?.substitutePpemY ?? ppemY
    const cbdt = this.tableManager.cbdt
    if (cbdt) {
      const result = cbdt.getGlyphBitmap(glyphId, sourceY, sourceX)
      if (result) return result
    }
    const ebdt = this.tableManager.ebdt
    if (ebdt) {
      const result = ebdt.getGlyphBitmap(glyphId, sourceY, sourceX)
      if (result) return result
    }
    return null
  }

  /**
   * Gets a bitmap glyph with all information required for rendering
   * (strike ppem, image format, normalized pixel metrics).
   * Checks sbix → CBDT → EBDT in specification priority order.
   * @param glyphId Glyph ID
   * @param ppem Requested pixel size (the closest strike is selected)
   */
  getBitmapGlyphRender(
    glyphId: number,
    ppemY: number,
    ppemX = ppemY,
    options?: { vertical?: boolean; ppi?: number },
  ): BitmapGlyphRenderData | null {
    // sbix (Apple standard bitmap graphics: PNG / JPEG / TIFF / dupe)
    const sbix = this.tableManager.sbix
    if (sbix !== null) {
      const resolved = this.resolveSbixGlyph(glyphId, ppemY, options?.ppi)
      if (resolved !== null) {
        const result = resolved.glyph
        const image = result.graphicType === 'png '
          ? 'png'
          : result.graphicType === 'jpg ' ? 'jpeg' : result.graphicType === 'tiff' ? 'tiff' : null
        if (image) {
          let designOriginX = 0
          let designOriginY = 0
          if (this.hasScalableOutlines) {
            const glyph = this.getGlyph(glyphId)
            if (glyph.outline.commands.length > 0) {
              designOriginX = glyph.xMin
              designOriginY = glyph.yMin
            }
          }
          return {
            image,
            data: result.data,
            ppem: resolved.ppem,
            ppemX: resolved.ppem,
            ppemY: resolved.ppem,
            ppi: resolved.ppi,
            width: 0,
            height: 0,
            bearingX: designOriginX + result.originOffsetX,
            bottom: designOriginY + result.originOffsetY,
            drawOutlines: sbix.drawOutlines,
          }
        }
      }
    }

    const substitute = this.tableManager.ebsc?.getSubstitutePpem(ppemX, ppemY)
    const sourceX = substitute?.substitutePpemX ?? ppemX
    const sourceY = substitute?.substitutePpemY ?? ppemY

    // CBDT (color bitmaps, PNG formats 17/18/19 plus legacy bitmap formats)
    const cbdt = this.tableManager.cbdt
    if (cbdt && cbdt.availableStrikes.length > 0) {
      const data = this.getEmbeddedBitmapRender('CBLC', glyphId, sourceX, sourceY, options?.vertical === true)
      if (data) return data
    }

    // EBDT (monochrome / grayscale bitmaps)
    const ebdt = this.tableManager.ebdt
    if (ebdt && ebdt.availableStrikes.length > 0) {
      const data = this.getEmbeddedBitmapRender('EBLC', glyphId, sourceX, sourceY, options?.vertical === true)
      if (data) return data
    }

    // bdat/bloc (Apple's legacy monochrome bitmaps; same structure as EBDT/EBLC,
    // used by bitmap-only fonts such as macOS NISC18030)
    const bdat = this.tableManager.bdat
    if (bdat && bdat.availableStrikes.length > 0) {
      const data = this.getEmbeddedBitmapRender('bloc', glyphId, sourceX, sourceY, options?.vertical === true)
      if (data) return data
    }

    return null
  }

  private resolveSbixGlyph(
    glyphId: number,
    targetPpem: number,
    targetPpi?: number,
  ): { glyph: SbixGlyphData, ppem: number, ppi: number } | null {
    const sbix = this.tableManager.sbix
    if (sbix === null || sbix.availableStrikes.length === 0) return null
    const strike = closestSbixStrike(sbix.availableStrikes, targetPpem, targetPpi)
    let result = sbix.getGlyphBitmap(glyphId, strike.ppem, strike.ppi)
    if (result === null) return null
    if (result.graphicType !== 'dupe') return { glyph: result, ppem: strike.ppem, ppi: strike.ppi }

    const visited = new Set<number>()
    visited.add(glyphId)
    while (result.graphicType === 'dupe') {
      const dupeGid = (result.data[0]! << 8) | result.data[1]!
      if (dupeGid >= this.numGlyphs) throw new Error(`sbix dupe glyph ID is out of range: ${dupeGid}`)
      if (visited.has(dupeGid)) throw new Error(`sbix dupe cycle detected at glyph ${dupeGid}`)
      visited.add(dupeGid)
      result = sbix.getGlyphBitmap(dupeGid, strike.ppem, strike.ppi)
      if (result === null) return null
    }
    return { glyph: result, ppem: strike.ppem, ppi: strike.ppi }
  }

  /** Shared CBDT/EBDT/bdat render-data path (locTag selects the location table) */
  private getEmbeddedBitmapRender(
    locTag: 'CBLC' | 'EBLC' | 'bloc',
    glyphId: number,
    ppemX: number,
    ppemY: number,
    vertical: boolean,
  ): BitmapGlyphRenderData | null {
    const table = locTag === 'CBLC' ? this.tableManager.cbdt! : locTag === 'bloc' ? this.tableManager.bdat! : this.tableManager.ebdt!
    const strikes = table.availableStrikes
    if (strikes.length === 0) return null
    const strike = closestStrike(strikes, ppemX, ppemY)
    const result = table.getGlyphBitmap(glyphId, strike.ppemY, strike.ppemX)
    if (!result) return null
    const metrics = result.metrics
    const hasBigMetrics = result.format === 5 || result.format === 6 || result.format === 7
      || result.format === 18 || result.format === 19
    const useVerticalMetrics = vertical && (hasBigMetrics || strike.flags === 2)
    const bearingX = useVerticalMetrics ? metrics.vertBearingX : metrics.horiBearingX
    const bottom = useVerticalMetrics
      ? -metrics.vertBearingY - metrics.height
      : metrics.horiBearingY - metrics.height

    if (result.format === 17 || result.format === 18 || result.format === 19) {
      // PNG data
      return {
        image: 'png',
        data: result.data,
        ppem: strike.ppemY,
        ppemX: strike.ppemX,
        ppemY: strike.ppemY,
        width: metrics.width,
        height: metrics.height,
        bearingX,
        bottom,
      }
    }

    // Legacy bitmap formats: 1/6 byte-aligned, 2/5/7 bit-aligned rows
    if (result.format === 1 || result.format === 2 || result.format === 5
      || result.format === 6 || result.format === 7) {
      return {
        image: strike.bitDepth === 32 ? 'bgra' : 'mask',
        data: result.data,
        ppem: strike.ppemY,
        ppemX: strike.ppemX,
        ppemY: strike.ppemY,
        width: metrics.width,
        height: metrics.height,
        bearingX,
        bottom,
        bitDepth: strike.bitDepth,
        bitAligned: result.format === 2 || result.format === 5 || result.format === 7,
      }
    }

    return null
  }

  /**
   * Gets the color font layers
   * Returns null if the COLR table is absent
   */
  getColorLayers(glyphId: number): ColorLayer[] | null {
    return this.tableManager.colr?.getColorLayers(glyphId) ?? null
  }

  /**
   * Gets the COLR v1 paint tree
   * Variable font: current normalized coordinates apply COLR ItemVariationStore deltas
   */
  getPaintTree(glyphId: number): PaintNode | null {
    return this.tableManager.colr?.getPaintTree(glyphId, this.tableManager.normalizedCoords) ?? null
  }

  /**
   * Gets the COLR v1 clip box
   * Variable font: current normalized coordinates apply COLR ItemVariationStore deltas
   */
  getClipBox(glyphId: number): ClipBox | null {
    return this.tableManager.colr?.getClipBox(glyphId, this.tableManager.normalizedCoords) ?? null
  }

  /**
   * Gets the OT-SVG glyph document (SVG table)
   * The document's glyph coordinate system is y-down with the origin at the
   * glyph origin; one unit equals one font design unit (gzip-compressed
   * documents are decompressed by the table parser)
   */
  getSvgGlyphDocument(glyphId: number): string | null {
    return this.tableManager.svg?.getSvgDocument(glyphId) ?? null
  }

  /**
   * Gets the number of color palettes
   */
  get numColorPalettes(): number {
    return this.tableManager.cpal?.numPalettes ?? 0
  }

  /** Currently selected CPAL palette index. */
  get colorPaletteIndex(): number {
    return this.selectedColorPaletteIndex
  }

  /** Returns CPAL v1 palette types and localized labels. */
  getColorPalettes(): readonly ColorPaletteInfo[] {
    const cpal = this.tableManager.cpal
    if (cpal === null) return []
    const name = this.tableManager.name
    const entryLabels: (string | null)[] = new Array(cpal.numPaletteEntries)
    for (let entry = 0; entry < entryLabels.length; entry++) {
      const nameId = cpal.paletteEntryLabelNameIds?.[entry] ?? 0xFFFF
      entryLabels[entry] = nameId === 0xFFFF ? null : (name.getName(nameId) ?? null)
    }
    const result: ColorPaletteInfo[] = new Array(cpal.numPalettes)
    for (let palette = 0; palette < cpal.numPalettes; palette++) {
      const type = cpal.paletteTypes?.[palette] ?? 0
      const nameId = cpal.paletteLabelNameIds?.[palette] ?? 0xFFFF
      result[palette] = {
        index: palette,
        usableWithLightBackground: (type & CPAL_USABLE_WITH_LIGHT_BACKGROUND) !== 0,
        usableWithDarkBackground: (type & CPAL_USABLE_WITH_DARK_BACKGROUND) !== 0,
        label: nameId === 0xFFFF ? null : (name.getName(nameId) ?? null),
        entryLabels,
      }
    }
    return result
  }

  /** Selects a palette explicitly or by its CPAL v1 background suitability. */
  setColorPalette(selection: number | 'light' | 'dark'): void {
    const cpal = this.tableManager.cpal
    if (cpal === null) throw new Error('Color palette selection requires a CPAL table')
    let index: number
    if (typeof selection === 'number') {
      if (!Number.isInteger(selection) || selection < 0 || selection >= cpal.numPalettes) {
        throw new Error(`CPAL palette index ${selection} is out of range`)
      }
      index = selection
    } else {
      const required = selection === 'light'
        ? CPAL_USABLE_WITH_LIGHT_BACKGROUND
        : CPAL_USABLE_WITH_DARK_BACKGROUND
      index = -1
      for (let i = 0; i < cpal.numPalettes; i++) {
        if (((cpal.paletteTypes?.[i] ?? 0) & required) !== 0) { index = i; break }
      }
      if (index < 0) throw new Error(`CPAL has no palette marked for a ${selection} background`)
    }
    this.selectedColorPaletteIndex = index
  }

  /** Applies application colors to selected CPAL entry indexes. */
  setColorPaletteOverrides(overrides: ReadonlyMap<number, ColorPaletteColor> | null): void {
    if (overrides !== null) {
      const cpal = this.tableManager.cpal
      if (cpal === null) throw new Error('Color palette overrides require a CPAL table')
      for (const [entry, color] of overrides) {
        if (!Number.isInteger(entry) || entry < 0 || entry >= cpal.numPaletteEntries) {
          throw new Error(`CPAL palette entry ${entry} is out of range`)
        }
        validatePaletteColor(color)
      }
    }
    this.colorPaletteOverrides = overrides
  }

  /**
   * Gets a color from a color palette
   * @returns RGBA color (each value 0-255) or null
   */
  getColorFromPalette(paletteIndex: number, colorIndex: number): { r: number, g: number, b: number, a: number } | null {
    const cpal = this.tableManager.cpal
    if (!cpal) return null
    if (paletteIndex >= cpal.numPalettes || colorIndex >= cpal.numPaletteEntries) return null
    const c = cpal.getColor(paletteIndex, colorIndex)
    return { r: c.red, g: c.green, b: c.blue, a: c.alpha }
  }

  /** Resolves an entry through the selected palette and application overrides. */
  getColorFromSelectedPalette(colorIndex: number): ColorPaletteColor | null {
    const override = this.colorPaletteOverrides?.get(colorIndex)
    if (override !== undefined) return override
    return this.getColorFromPalette(this.selectedColorPaletteIndex, colorIndex)
  }

  // --- Direct table access API ---

  /** MATH table (math typesetting) */
  get math(): MathTable | null {
    return this.tableManager.math
  }

  /** BASE table (baseline adjustment) */
  get base(): BaseTable | null {
    return this.tableManager.base
  }

  /** JSTF table (justification) */
  get jstf(): JstfTable | null {
    return this.tableManager.jstf
  }

  /** GDEF table (glyph classes, attachment points, and ligature carets). */
  get gdef(): GdefTable | null {
    return this.tableManager.gdef
  }

  /** OpenType `meta` table. */
  get meta(): MetaTable | null {
    return this.tableManager.meta
  }

  /** PCL 5 printer compatibility metrics and classification data. */
  get pclt(): PcltTable | null {
    return this.tableManager.pclt
  }

  /** OpenType digital-signature table attached to this standalone font. */
  get dsig(): DsigTable | null {
    return this.tableManager.dsig
  }

  /** Verifies every DSIG signature attached to this font or its collection. */
  verifySignatures(): OpenTypeSignatureVerification[] {
    return verifyOpenTypeSignatures(this.tableManager.sfnt, this.tableManager.dsig)
  }

  /** AAT `ltag` language-tag table. */
  get ltag(): LtagTable | null {
    return this.tableManager.ltag
  }

  getLanguageTag(index: number): string | null {
    return this.tableManager.ltag?.getTag(index) ?? null
  }

  /** Graphite rule passes and class maps. */
  get silf(): SilfTable | null {
    return this.tableManager.silf
  }

  /** Graphite glyph-attribute locations. */
  get gloc(): GlocTable | null {
    return this.tableManager.gloc
  }

  /** Graphite glyph attributes. */
  get glat(): GlatTable | null {
    return this.tableManager.glat
  }

  /** Graphite language-specific feature defaults. */
  get sill(): SillTable | null {
    return this.tableManager.sill
  }

  /** Graphite feature definitions. */
  get graphiteFeatures(): GraphiteFeatTable | null {
    return this.tableManager.graphiteFeat
  }

  /** just table (Apple AAT Justification) */
  get just(): JustTable | null {
    return this.tableManager.just
  }

  /** feat table (Apple AAT Feature Names) */
  get feat(): FeatTable | null {
    return this.tableManager.feat
  }

  /** Resolves AAT feature and setting names, exclusivity, and default selectors. */
  getAatFeatureDescriptions(): readonly AatFeatureDescription[] {
    const feat = this.tableManager.feat
    if (feat === null) return []
    const name = this.tableManager.name
    const result = new Array<AatFeatureDescription>(feat.features.length)
    for (let i = 0; i < feat.features.length; i++) {
      const feature = feat.features[i]!
      const exclusive = (feature.featureFlags & 0x8000) !== 0
      let defaultSelector: number | null = null
      if (exclusive && feature.selectors.length > 0) {
        const defaultIndex = (feature.featureFlags & 0x4000) !== 0
          ? feature.featureFlags & 0x00FF
          : 0
        defaultSelector = feature.selectors[defaultIndex]!.selectorValue
      }
      const settings = new Array<AatFeatureSettingDescription>(feature.selectors.length)
      for (let j = 0; j < feature.selectors.length; j++) {
        const setting = feature.selectors[j]!
        let languageTag: string | null = null
        if (feature.featureType === 39 && setting.selectorValue > 0) {
          languageTag = this.tableManager.ltag?.getTag(setting.selectorValue - 1) ?? null
          if (languageTag === null) {
            throw new Error(`AAT language selector ${setting.selectorValue} has no ltag entry`)
          }
        }
        settings[j] = {
          selector: setting.selectorValue,
          nameId: setting.nameIndex,
          name: name.getName(setting.nameIndex) ?? null,
          languageTag,
        }
      }
      result[i] = {
        featureType: feature.featureType,
        nameId: feature.nameIndex,
        name: name.getName(feature.nameIndex) ?? null,
        exclusive,
        defaultSelector,
        settings,
      }
    }
    return result
  }

  /** trak table (Apple AAT Tracking) */
  get trak(): TrakTable | null {
    return this.tableManager.trak
  }

  /** opbd table (Apple AAT Optical Bounds) */
  get opbd(): OpbdTable | null {
    return this.tableManager.opbd
  }

  /** bsln table (Apple AAT Baseline) */
  get bsln(): BslnTable | null {
    return this.tableManager.bsln
  }

  /** lcar table (Apple AAT Ligature Caret) */
  get lcar(): LcarTable | null {
    return this.tableManager.lcar
  }

  /** acnt table (Apple AAT accent attachment). */
  get acnt(): AcntTable | null {
    return this.tableManager.acnt
  }

  /** ankr table (Apple AAT anchor-point coordinates). */
  get ankr(): AnkrTable | null {
    return this.tableManager.ankr
  }

  /** fdsc table (Apple AAT font descriptors). */
  get fdsc(): FdscTable | null {
    return this.tableManager.fdsc
  }

  /** fmtx table (Apple AAT point-defined font metrics). */
  get fmtx(): FmtxTable | null {
    return this.tableManager.fmtx
  }

  /** gcid table (Apple AAT glyph-to-CID mapping). */
  get gcid(): GcidTable | null {
    return this.tableManager.gcid
  }

  /** prop table (Apple AAT glyph properties). */
  get prop(): PropTable | null {
    return this.tableManager.prop
  }

  /** Zapf table (Apple AAT glyph reference information). */
  get zapf(): ZapfTable | null {
    return this.tableManager.zapf
  }

  /** MERG table (glyph merge classes). */
  get merg(): MergTable | null {
    return this.tableManager.merg
  }

  /** Resolves an acnt accented glyph to control-point coordinates. */
  getAccentAttachment(glyphId: number): {
    primaryGlyphId: number
    components: readonly {
      secondaryGlyphId: number
      primaryPoint: { x: number, y: number }
      secondaryPoint: { x: number, y: number }
    }[]
  } | null {
    const attachment: AcntGlyphAttachment | null = this.tableManager.acnt?.getAttachment(glyphId) ?? null
    if (attachment === null) return null
    return {
      primaryGlyphId: attachment.primaryGlyphIndex,
      components: attachment.components.map((component) => ({
        secondaryGlyphId: component.secondaryGlyphIndex,
        primaryPoint: this.getGlyphControlPoint(attachment.primaryGlyphIndex, component.primaryAttachmentPoint),
        secondaryPoint: this.getGlyphControlPoint(component.secondaryGlyphIndex, component.secondaryGlyphAttachmentNumber),
      })),
    }
  }

  /** Returns the AAT anchor-point coordinates associated with a glyph. */
  getAatAnchorPoints(glyphId: number): readonly AnkrAnchorPoint[] | null {
    return this.tableManager.ankr?.getAnchorPoints(glyphId) ?? null
  }

  /** Returns an fdsc descriptor value by tag. */
  getAatFontDescriptor(tag: string): number | null {
    return this.tableManager.fdsc?.getDescriptor(tag) ?? null
  }

  /** Resolves all fmtx point references to font-unit coordinates. */
  getAatPointMetrics(): {
    horizontalBefore: { x: number, y: number }
    horizontalAfter: { x: number, y: number }
    horizontalCaretHead: { x: number, y: number }
    horizontalCaretBase: { x: number, y: number }
    verticalBefore: { x: number, y: number }
    verticalAfter: { x: number, y: number }
    verticalCaretHead: { x: number, y: number }
    verticalCaretBase: { x: number, y: number }
  } | null {
    const table = this.tableManager.fmtx
    if (table === null) return null
    const glyphId = table.glyphIndex
    const metrics = {
      horizontalBefore: this.getGlyphControlPoint(glyphId, table.horizontalBefore),
      horizontalAfter: this.getGlyphControlPoint(glyphId, table.horizontalAfter),
      horizontalCaretHead: this.getGlyphControlPoint(glyphId, table.horizontalCaretHead),
      horizontalCaretBase: this.getGlyphControlPoint(glyphId, table.horizontalCaretBase),
      verticalBefore: this.getGlyphControlPoint(glyphId, table.verticalBefore),
      verticalAfter: this.getGlyphControlPoint(glyphId, table.verticalAfter),
      verticalCaretHead: this.getGlyphControlPoint(glyphId, table.verticalCaretHead),
      verticalCaretBase: this.getGlyphControlPoint(glyphId, table.verticalCaretBase),
    }
    if (metrics.horizontalCaretBase.y !== 0) {
      throw new Error(`fmtx horizontal caret base y-coordinate must be zero, got ${metrics.horizontalCaretBase.y}`)
    }
    if (metrics.verticalCaretBase.x !== 0) {
      throw new Error(`fmtx vertical caret base x-coordinate must be zero, got ${metrics.verticalCaretBase.x}`)
    }
    return metrics
  }

  /** Returns the CID associated with a glyph by gcid. */
  getGlyphCid(glyphId: number): number | null {
    return this.tableManager.gcid?.getCid(glyphId) ?? null
  }

  /** Returns the AAT prop property word for a glyph. */
  getAatGlyphProperties(glyphId: number): number | null {
    return this.tableManager.prop?.getProperties(glyphId) ?? null
  }

  /** Decodes every semantic field in the AAT prop property word. */
  getAatGlyphPropertyInfo(glyphId: number): AatGlyphProperties | null {
    const prop = this.tableManager.prop
    if (prop === null) return null
    const raw = prop.getProperties(glyphId)
    const usesComplementaryBracket = (raw & PROP_USE_COMPLEMENTARY_BRACKET) !== 0
    let complementaryGlyphId: number | null = null
    if (usesComplementaryBracket) {
      complementaryGlyphId = glyphId + getComplementOffset(raw)
      if (complementaryGlyphId < 0 || complementaryGlyphId >= this.numGlyphs) {
        throw new Error(`AAT prop complementary glyph ${complementaryGlyphId} exceeds numGlyphs ${this.numGlyphs}`)
      }
    }
    return {
      raw,
      floater: (raw & PROP_FLOATER) !== 0,
      hangsLeftOrTop: (raw & PROP_HANG_OFF_LEFT_TOP) !== 0,
      hangsRightOrBottom: (raw & PROP_HANG_OFF_RIGHT_BOTTOM) !== 0,
      usesComplementaryBracket,
      complementaryGlyphId,
      attachesOnRight: (raw & PROP_ATTACHES_ON_RIGHT) !== 0,
      directionalityClass: raw & PROP_DIRECTIONALITY_MASK,
    }
  }

  /** Returns Zapf glyph reference information. */
  getZapfGlyphInfo(glyphId: number): ZapfGlyphInfo | null {
    return this.tableManager.zapf?.getGlyphInfo(glyphId) ?? null
  }

  /** Returns the MERG action for a glyph pair. */
  getMergeAction(leftGlyphId: number, rightGlyphId: number): number | null {
    return this.tableManager.merg?.getMergeAction(leftGlyphId, rightGlyphId) ?? null
  }

  /** Resolves MERG sequences that must be composed before antialiasing. */
  getMergeGroups(glyphIds: ArrayLike<number>, direction: 'ltr' | 'rtl' = 'ltr'): readonly MergGlyphGroup[] {
    const merg = this.tableManager.merg
    if (merg === null) {
      const groups = new Array<MergGlyphGroup>(glyphIds.length)
      for (let i = 0; i < glyphIds.length; i++) groups[i] = { start: i, end: i + 1, mergeRequired: false }
      return groups
    }
    return merg.getMergeGroups(glyphIds, direction)
  }

  /** EBSC table (Embedded Bitmap Scaling) */
  get ebsc(): EbscTable | null {
    return this.tableManager.ebsc
  }

  /**
   * Gets the tracking value (Apple AAT trak table)
   * @param trackValue Tracking value (Fixed 16.16)
   * @param pointSize Point size
   * @param direction Text direction for selecting horizontal or vertical trak data
   */
  getTracking(trackValue: number, pointSize: number, direction: 'horizontal' | 'vertical' = 'horizontal'): number {
    const trak = this.tableManager.trak
    if (!trak) return 0
    return trak.getTracking(direction === 'horizontal', trackValue, pointSize)
  }

  /**
   * Gets the AAT just grow weight for a glyph.
   * Positive before/after grow limits make the glyph eligible for justification expansion.
   */
  getJustificationGrowWeight(glyphId: number, direction: 'horizontal' | 'vertical' = 'horizontal'): number {
    const just = this.tableManager.just
    const data = direction === 'horizontal' ? just?.horizontal : just?.vertical
    if (data == null) return 0
    const pairs = data.getWidthDeltaPairs(glyphId)
    if (pairs == null) return 0
    let weight = 0
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i]!
      if (pair.beforeGrowLimit > 0) weight += pair.beforeGrowLimit
      if (pair.afterGrowLimit > 0) weight += pair.afterGrowLimit
    }
    return weight
  }

  /**
   * Gets the optical bounds (Apple AAT opbd table)
   * @param glyphId Glyph ID
   */
  getOpticalBounds(glyphId: number): OpbdBounds | null {
    const opbd = this.tableManager.opbd
    if (!opbd) return null
    const bounds = opbd.getOpticalBounds(glyphId)
    if (bounds === null || opbd.format === 0) return bounds
    return {
      left: this.resolveOpticalControlPoint(glyphId, bounds.left, 'left'),
      top: this.resolveOpticalControlPoint(glyphId, bounds.top, 'top'),
      right: this.resolveOpticalControlPoint(glyphId, bounds.right, 'right'),
      bottom: this.resolveOpticalControlPoint(glyphId, bounds.bottom, 'bottom'),
    }
  }

  private resolveOpticalControlPoint(
    glyphId: number,
    pointIndex: number,
    side: 'left' | 'top' | 'right' | 'bottom',
  ): number {
    if (pointIndex === -1) return 0
    const point = this.getGlyphControlPoint(glyphId, pointIndex)
    if (side === 'left') return -point.x
    if (side === 'right') return this.getAdvanceWidth(glyphId) - point.x
    const fromVerticalOrigin = this.getVerticalOrigin(glyphId) - point.y
    return side === 'top' ? fromVerticalOrigin : fromVerticalOrigin - this.getAdvanceHeight(glyphId)
  }

  /**
   * TrueType control point coordinate after composite resolution and variation deltas.
   * Used by AAT tables whose values point into glyph outlines.
   */
  getGlyphControlPoint(glyphId: number, pointIndex: number): { x: number, y: number } {
    const glyfReader = getTableReader(this.tableManager.sfnt, 'glyf')
    if (!glyfReader) throw new Error('Glyph control point lookup requires a glyf table')
    const glyph = composeGlyphPoints(
      glyfReader,
      this.tableManager.loca,
      glyphId,
      this.tableManager.gvar,
      this.tableManager.normalizedCoords,
      this.tableManager.glyphPhantomPointProvider,
    )
    if (pointIndex < 0 || pointIndex >= glyph.numPoints) {
      throw new Error(`Glyph ${glyphId} control point ${pointIndex} out of range (${glyph.numPoints} points)`)
    }
    return { x: glyph.xCoords[pointIndex]!, y: glyph.yCoords[pointIndex]! }
  }

  /** Resolves an Anchor format-2 contour point in grid-fitted font units. */
  getGposAnchorPoint(glyphId: number, pointIndex: number, ppem: number): { x: number, y: number } | null {
    const state = this.getTrueTypeHintingState(glyphId, ppem)
    if (state === null) return null
    if (pointIndex < 0 || pointIndex >= state.x.length) {
      throw new Error(`Glyph ${glyphId} GPOS anchor point ${pointIndex} out of range (${state.x.length} points)`)
    }
    const scale = this.metrics.unitsPerEm / (ppem * 64)
    return { x: state.x[pointIndex]! * scale, y: state.y[pointIndex]! * scale }
  }

  /** GDEF attachment points resolved to current-instance outline coordinates. */
  getGdefAttachmentPoints(glyphId: number): readonly { pointIndex: number, x: number, y: number }[] {
    const indices = this.tableManager.gdef?.getAttachmentPointIndices(glyphId) ?? []
    const points = new Array<{ pointIndex: number, x: number, y: number }>(indices.length)
    for (let i = 0; i < indices.length; i++) {
      const pointIndex = indices[i]!
      const point = this.getGlyphControlPoint(glyphId, pointIndex)
      points[i] = { pointIndex, x: point.x, y: point.y }
    }
    return points
  }

  /**
   * Ligature caret positions in font units. OpenType GDEF values take
   * precedence over AAT lcar values. Contour-point values are resolved against
   * the current glyph instance and Device values use the requested ppem.
   */
  getLigatureCaretPositions(
    glyphId: number,
    direction: 'horizontal' | 'vertical' = 'horizontal',
    ppem?: number,
  ): number[] | null {
    const gdefValues = this.tableManager.gdef?.getLigatureCaretValues(
      glyphId, ppem, this.tableManager.normalizedCoords ?? undefined,
    ) ?? null
    if (gdefValues !== null) {
      const out = new Array<number>(gdefValues.length)
      for (let i = 0; i < gdefValues.length; i++) {
        const value = gdefValues[i]!
        if (value.pointIndex !== null) {
          const point = this.getGlyphControlPoint(glyphId, value.pointIndex)
          out[i] = direction === 'horizontal' ? point.x : this.getVerticalOrigin(glyphId) - point.y
        } else {
          const deviceUnits = ppem === undefined ? 0 : value.deviceDelta * this.metrics.unitsPerEm / ppem
          out[i] = value.coordinate + deviceUnits
        }
      }
      return out
    }
    const lcar = this.tableManager.lcar
    if (!lcar) return null
    const values = lcar.getCaretValues(glyphId)
    if (values === null) return null
    const out = new Array<number>(values.length)
    if (lcar.format === 0) {
      for (let i = 0; i < values.length; i++) out[i] = values[i]!
      return out
    }
    for (let i = 0; i < values.length; i++) {
      const point = this.getGlyphControlPoint(glyphId, values[i]!)
      out[i] = direction === 'horizontal' ? point.x : this.getVerticalOrigin(glyphId) - point.y
    }
    return out
  }

  /**
   * Baseline class for a glyph from the AAT bsln table.
   */
  getAatBaselineClass(glyphId: number): number | null {
    const bsln = this.tableManager.bsln
    if (!bsln) return null
    return bsln.getBaselineClass(glyphId)
  }

  /**
   * Baseline coordinate in font units from the AAT bsln table.
   * Distance formats return the baseline delta directly. Control-point formats
   * resolve the standard glyph's referenced control point y coordinate.
   */
  getAatBaselineCoordinate(glyphId: number): number | null {
    const bsln = this.tableManager.bsln
    if (!bsln) return null
    return this.getAatBaselinePosition(bsln.getBaselineClass(glyphId))
  }

  /** Position of one of the 32 AAT baseline classes in font units. */
  getAatBaselinePosition(baselineClass: number): number | null {
    if (!Number.isInteger(baselineClass) || baselineClass < 0 || baselineClass >= 32) {
      throw new Error(`AAT baseline class must be in the range 0..31, got ${baselineClass}`)
    }
    const bsln = this.tableManager.bsln
    if (!bsln) return null
    if (bsln.deltas !== null) return bsln.deltas[baselineClass]!
    if (bsln.ctlPoints === null || bsln.stdGlyph === null) return null
    const pointIndex = bsln.ctlPoints[baselineClass]!
    if (pointIndex === 0xFFFF) return null
    return this.getGlyphControlPoint(bsln.stdGlyph, pointIndex).y
  }

  // --- Device metrics API (hdmx / LTSH / VDMX / gasp) ---

  /**
   * Device advance width in pixels at the given ppem (hdmx table).
   * @returns the pre-computed pixel advance, or null when the table or the
   *          ppem record is absent
   */
  getDeviceAdvanceWidth(glyphId: number, ppem: number): number | null {
    const hdmx = this.tableManager.hdmx
    if (!hdmx) return null
    return hdmx.getWidth(ppem, glyphId)
  }

  /**
   * Whether the glyph's advance scales linearly at the given ppem
   * (LTSH table linear threshold).
   * @returns true/false per the table, or null when LTSH is absent
   */
  isLinearAtPpem(glyphId: number, ppem: number): boolean | null {
    const ltsh = this.tableManager.ltsh
    if (!ltsh) return null
    const threshold = ltsh.getLinearThreshold(glyphId)
    // A threshold value of 1 means the glyph always scales linearly; per the
    // spec, values above 254 apply through 255 and 50%-rule sizes beyond it
    return threshold <= 1 || ppem >= threshold
  }

  /**
   * Exact raster vertical bounds at the given ppem (VDMX table).
   * @returns yMax/yMin in pixels, or null when unavailable
   */
  getDeviceVerticalBounds(ppem: number, xRatio?: number, yRatio?: number, characterSet?: 0 | 1): { yMax: number, yMin: number } | null {
    if (this.tableManager.fvar !== null) return null
    const vdmx = this.tableManager.vdmx
    if (!vdmx) return null
    return vdmx.getYBounds(ppem, xRatio, yRatio, characterSet)
  }

  /**
   * Grid-fitting / anti-aliasing behavior flags at the given ppem
   * (gasp table; GASP_* flag constants).
   * @returns the flag bits, or null when the table is absent
   */
  getGaspBehavior(ppem: number): number | null {
    const gasp = this.tableManager.gasp
    if (!gasp) return null
    const coords = this.tableManager.normalizedCoords
    const mvar = coords === null ? null : this.tableManager.mvar
    for (let i = 0; i < gasp.ranges.length; i++) {
      const range = gasp.ranges[i]!
      let maximum = range.rangeMaxPPEM
      if (mvar !== null && i < 10 && i + 1 < gasp.ranges.length) {
        maximum += mvar.getMetricDelta(`gsp${i}`, coords!)
      }
      if (ppem <= maximum) return range.rangeGaspBehavior
    }
    return gasp.ranges[gasp.ranges.length - 1]!.rangeGaspBehavior
  }

  /**
   * Resolves all ppem-dependent metrics and raster policy through one model.
   * Vector layout continues to use hmtx/vmtx; callers opt into these integer
   * metrics only when targeting a concrete raster device.
   */
  getDeviceMetrics(glyphId: number, xPpem: number, yPpem = xPpem, characterSet?: 0 | 1): FontDeviceMetrics {
    if (!Number.isInteger(xPpem) || xPpem <= 0 || !Number.isInteger(yPpem) || yPpem <= 0) {
      throw new Error(`Device ppem values must be positive integers, got ${xPpem}x${yPpem}`)
    }
    if (!Number.isInteger(glyphId) || glyphId < 0 || glyphId >= this.numGlyphs) {
      throw new Error(`Glyph ID ${glyphId} exceeds font glyph count`)
    }

    const behavior = this.getGaspBehavior(yPpem)
    const gridFit = behavior === null || (behavior & GASP_GRIDFIT) !== 0
    const headAllowsNonlinear = (this.tableManager.head.flags & 0x0010) !== 0
    const ltshLinear = this.isLinearAtPpem(glyphId, yPpem)
    const linearAdvance = !gridFit || !headAllowsNonlinear || ltshLinear === true
    const linearF26Dot6 = Math.round(this.getAdvanceWidth(glyphId) * xPpem * 64 / this.metrics.unitsPerEm)
    const linearPixels = Math.floor((linearF26Dot6 + 32) / 64)

    let advanceWidthPixels = linearPixels
    let advanceSource: FontDeviceMetrics['advanceSource'] = 'linear'
    if (!linearAdvance) {
      const deviceWidth = this.getDeviceAdvanceWidth(glyphId, xPpem)
      if (deviceWidth !== null) {
        advanceWidthPixels = deviceWidth
        advanceSource = 'hdmx'
      } else {
        const hinted = this.getHintedGlyph(glyphId, yPpem, xPpem)
        advanceWidthPixels = Math.round(hinted.advanceWidth * xPpem / this.metrics.unitsPerEm)
        advanceSource = 'interpreter'
      }
    }

    const ratioDivisor = greatestCommonDivisor(xPpem, yPpem)
    const vdmx = gridFit
      ? this.getDeviceVerticalBounds(yPpem, xPpem / ratioDivisor, yPpem / ratioDivisor, characterSet)
      : null
    const verticalBounds = vdmx ?? {
      yMax: Math.ceil(this.metrics.horizontalClippingAscent * yPpem / this.metrics.unitsPerEm),
      yMin: -Math.ceil(this.metrics.horizontalClippingDescent * yPpem / this.metrics.unitsPerEm),
    }

    return {
      xPpem,
      yPpem,
      advanceWidthPixels,
      advanceSource,
      linearAdvance,
      verticalBounds,
      verticalBoundsSource: vdmx === null ? 'scaled' : 'VDMX',
      gaspBehavior: behavior,
      gridFit,
      grayscale: behavior !== null && (behavior & GASP_DOGRAY) !== 0,
      symmetricGridFit: behavior !== null && (behavior & GASP_SYMMETRIC_GRIDFIT) !== 0,
      symmetricSmoothing: behavior !== null && (behavior & GASP_SYMMETRIC_SMOOTHING) !== 0,
    }
  }

  // --- Font metadata API (meta table) ---

  /**
   * A metadata value from the `meta` table by its tag (e.g. 'dlng', 'slng').
   * @returns the UTF-8 value, or null when the table or tag is absent
   */
  getFontMetadata(tag: string): string | null {
    const meta = this.tableManager.meta
    if (!meta) return null
    return meta.getValue(tag)
  }

  /**
   * Design languages the font was primarily designed for (`meta` 'dlng': a
   * comma-separated list of ScriptLangTags, e.g. 'en-Latn, ja-Jpan').
   * @returns the trimmed tags in priority order, or null when absent
   */
  getDesignLanguages(): string[] | null {
    return this.parseMetaLanguageTags('dlng')
  }

  /**
   * Languages the font supports (`meta` 'slng'), same ScriptLangTag list form.
   * @returns the trimmed tags in priority order, or null when absent
   */
  getSupportedLanguages(): string[] | null {
    return this.parseMetaLanguageTags('slng')
  }

  /** Splits a `meta` ScriptLangTag list ('dlng'/'slng') on commas, trimming
   *  the whitespace the spec permits after each separator. */
  private parseMetaLanguageTags(tag: string): string[] | null {
    const value = this.getFontMetadata(tag)
    if (value === null) return null
    const tags: string[] = []
    for (const part of value.split(',')) {
      const trimmed = part.trim()
      if (trimmed.length > 0) tags.push(trimmed)
    }
    return tags
  }

  // --- Variable Font API ---

  /** List of variation axes */
  get variationAxes(): VariationAxis[] {
    return this.tableManager.fvar?.axes ?? []
  }

  /** List of named instances */
  get namedInstances(): NamedInstance[] {
    return this.tableManager.fvar?.instances ?? []
  }

  /** Selects an fvar named instance by its zero-based record index. */
  setNamedInstance(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.namedInstances.length) {
      throw new Error(`Named variation instance index ${index} is out of range`)
    }
    this.setVariation(Object.fromEntries(this.namedInstances[index]!.coordinates))
  }

  /** Localized subfamily name for an fvar named instance. */
  getNamedInstanceName(index: number): string | null {
    const instance = this.namedInstanceAt(index)
    return this.tableManager.name?.getName(instance.subfamilyNameId) ?? null
  }

  /** PostScript name for an fvar named instance when the record provides one. */
  getNamedInstancePostScriptName(index: number): string | null {
    const nameId = this.namedInstanceAt(index).postScriptNameId
    return nameId === undefined || nameId === 0xFFFF ? null : this.tableManager.name?.getName(nameId) ?? null
  }

  private namedInstanceAt(index: number): NamedInstance {
    if (!Number.isInteger(index) || index < 0 || index >= this.namedInstances.length) {
      throw new Error(`Named variation instance index ${index} is out of range`)
    }
    return this.namedInstances[index]!
  }

  /** Whether this is a Variable Font */
  get isVariable(): boolean {
    return this.tableManager.fvar !== null
  }

  /** Active user-space variation coordinates, or null at the default instance. */
  get variationCoordinates(): Readonly<Record<string, number>> | null {
    return this.currentUserCoords
  }

  /** Current normalized variation coordinates in fvar axis order. */
  getNormalizedVariationCoordinates(): number[] | null {
    return this.tableManager.normalizedCoords?.slice() ?? null
  }

  /**
   * Resolves a glyph and its HVAR-aware advance at a temporary variation
   * instance without changing the font's externally visible variation state.
   */
  getGlyphAtVariation(glyphId: number, coords: Record<string, number>): {
    glyph: Glyph
    advanceWidth: number
    advanceHeight: number
  } {
    if (this.tableManager.fvar === null) throw new Error('A variation glyph requires an fvar table')
    const previous = this.currentUserCoords === null ? {} : { ...this.currentUserCoords }
    this.setVariation(coords)
    try {
      return {
        glyph: this.getGlyph(glyphId),
        advanceWidth: this.getAdvanceWidth(glyphId),
        advanceHeight: this.getAdvanceHeight(glyphId),
      }
    } finally {
      this.setVariation(previous)
    }
  }

  /**
   * Sets variation coordinates
   * @param coords Mapping of axis tag → user value (e.g. { wght: 700, wdth: 100 })
   */
  /**
   * Bold state under the active variation: the wght coordinate overrides
   * the static OS/2 bit (STAT format 3 style linking supplies the bold
   * threshold when present) so synthetic bold does not double up.
   */
  private variationIsBold(staticBold: boolean): boolean {
    const coords = this.currentUserCoords
    if (coords === null || coords['wght'] === undefined) return staticBold
    const wght = coords['wght']!
    const stat = this.tableManager.stat
    if (stat !== null) {
      for (const av of stat.axisValues) {
        if (av.format === 3 && av.linkedValue !== undefined && stat.designAxes[av.axisIndex]?.tag === 'wght') {
          return wght >= av.linkedValue
        }
      }
    }
    return wght >= 600
  }

  /** Italic state under the active variation (ital / slnt axes). */
  private variationIsItalic(staticItalic: boolean): boolean {
    const coords = this.currentUserCoords
    if (coords === null) return staticItalic
    if (coords['ital'] !== undefined) return coords['ital']! >= 0.5
    if (coords['slnt'] !== undefined && coords['slnt'] !== 0) return true
    return staticItalic
  }

  /**
   * Composes a style name for the current variation coordinates from the
   * STAT table (ISO/IEC 14496-22 7.3.7): per design-axis ordering, the
   * matching AxisValue names concatenate (format 4 combinations first,
   * then formats 1/3 exact and 2 range matches); ELIDABLE names are
   * omitted, with the elided fallback name when everything elides.
   * Returns null when the font has no STAT table or no variation is set.
   */
  getVariationStyleName(): string | null {
    const stat = this.tableManager.stat
    const nameTable = this.tableManager.name
    if (stat === null || this.currentUserCoords === null) return null
    const coords = this.currentUserCoords
    const axisTag = (index: number): string | null => stat.designAxes[index]?.tag ?? null
    const matchedByAxis = new Map<number, StatAxisValue>()
    const usedAxes = new Set<number>()

    // Format 4 combinations claim all their axes at once (highest priority)
    for (const av of stat.axisValues) {
      if (av.format !== 4 || av.axisValues === undefined) continue
      let all = true
      for (const entry of av.axisValues) {
        const tag = axisTag(entry.axisIndex)
        if (tag === null || coords[tag] === undefined || coords[tag] !== entry.value) { all = false; break }
      }
      if (all && av.axisValues.length > 0 && !av.axisValues.some(e => usedAxes.has(e.axisIndex))) {
        matchedByAxis.set(av.axisValues[0]!.axisIndex, av)
        for (const entry of av.axisValues) usedAxes.add(entry.axisIndex)
      }
    }
    for (const av of stat.axisValues) {
      if (av.format === 4 || usedAxes.has(av.axisIndex)) continue
      const tag = axisTag(av.axisIndex)
      if (tag === null || coords[tag] === undefined) continue
      const v = coords[tag]!
      const hit = (av.format === 1 || av.format === 3)
        ? av.value === v
        : av.format === 2
          ? (av.rangeMinValue !== undefined && av.rangeMaxValue !== undefined && v >= av.rangeMinValue && v <= av.rangeMaxValue)
          : false
      if (hit) {
        matchedByAxis.set(av.axisIndex, av)
        usedAxes.add(av.axisIndex)
      }
    }

    // Concatenate names in design-axis ordering, skipping elidable ones
    const ordered = [...matchedByAxis.entries()]
      .sort((a, b) => (stat.designAxes[a[0]]?.ordering ?? 0) - (stat.designAxes[b[0]]?.ordering ?? 0))
    const parts: string[] = []
    for (const [, av] of ordered) {
      if ((av.flags & 0x0002) !== 0) continue // ELIDABLE_AXIS_VALUE_NAME
      const name = nameTable?.getName(av.valueNameId)
      if (name !== undefined && name !== '') parts.push(name)
    }
    if (parts.length === 0) {
      const fallback = stat.elidedFallbackNameId !== undefined ? nameTable?.getName(stat.elidedFallbackNameId) : undefined
      return fallback !== undefined && fallback !== '' ? fallback : null
    }
    return parts.join(' ')
  }

  setVariation(coords: Record<string, number>): void {
    const fvar = this.tableManager.fvar
    if (!fvar) return

    const avar = this.tableManager.avar
    const rawNormalized: number[] = []
    let hasNonDefault = false
    const userCoords: Record<string, number> = {}

    for (let i = 0; i < fvar.axes.length; i++) {
      const axis = fvar.axes[i]!
      const val = coords[axis.tag] ?? axis.defaultValue

      // Clamp to axis range
      const clamped = Math.max(axis.minValue, Math.min(axis.maxValue, val))
      userCoords[axis.tag] = clamped
      if (clamped !== axis.defaultValue) hasNonDefault = true

      // Normalize to [-1, 1]
      let norm: number
      if (clamped < axis.defaultValue) {
        norm = axis.defaultValue === axis.minValue
          ? 0
          : -(axis.defaultValue - clamped) / (axis.defaultValue - axis.minValue)
      } else if (clamped > axis.defaultValue) {
        norm = axis.defaultValue === axis.maxValue
          ? 0
          : (clamped - axis.defaultValue) / (axis.maxValue - axis.defaultValue)
      } else {
        norm = 0
      }

      rawNormalized.push(norm)
    }

    let normalized: number[]
    if (avar) {
      if (avar.hasV2) {
        const intermediate: number[] = new Array<number>(rawNormalized.length)
        for (let i = 0; i < rawNormalized.length; i++) {
          intermediate[i] = avar.mapAxisValue(i, rawNormalized[i]!)
        }
        normalized = new Array<number>(rawNormalized.length)
        for (let i = 0; i < rawNormalized.length; i++) {
          normalized[i] = clampNormalizedCoordinate(avar.mapAxisValueV2(i, rawNormalized[i]!, intermediate))
        }
      } else {
        normalized = new Array<number>(rawNormalized.length)
        for (let i = 0; i < rawNormalized.length; i++) {
          normalized[i] = avar.mapAxisValue(i, rawNormalized[i]!)
        }
      }
    } else {
      normalized = rawNormalized
    }

    this.currentUserCoords = hasNonDefault ? userCoords : null
    this.tableManager.setNormalizedCoords(normalized)
    this.glyphCache.clear()
    this.trueTypeVariationMetricsCache.clear()
    this.metricsCache = null
    // Grid-fitting depends on the variation state (gvar outline + cvar CVT)
    this.ttHinter = undefined
    this.hintedGlyphCache.clear()
  }

  /**
   * Gets the glyph ID with a variation selector
   */
  getGlyphIdWithVariation(codePoint: number, variationSelector: number): number {
    const glyphId = this.tableManager.cmap.getVariationGlyphId(codePoint, variationSelector)
    return glyphId === null ? this.getGlyphId(codePoint) : glyphId
  }

  /**
   * Text shaping: codepoints → cmap → glyphIds → GSUB substitution → GPOS positioning
   * @param text Input text
   * @param options Shaping options
   * @returns Array of shaped glyphs
   */
  shapeText(text: string, options?: ShapeOptions): ShapedGlyph[] {
    const script = options?.script ?? null
    const language = options?.language ?? null
    const direction = options?.direction ?? 'horizontal'

    // 1. Collect code points and scan for scripts that need preprocessing.
    // The scan is a single pass with an early skip for code points below
    // U+0300 so plain ASCII pays no lookup cost.
    const cps: number[] = []
    for (const char of text) cps.push(char.codePointAt(0)!)
    const sourceCodePoints = cps.slice()
    const sourceClusterStarts = new Uint32Array(cps.length)
    if (cps.length > 0) {
      const sourceChars = [...text]
      const boundaries = buildGraphemeBoundaryFlags(sourceChars)
      let clusterStart = 0
      for (let k = 0; k < cps.length; k++) {
        if (boundaries[k] === 1) clusterStart = k
        sourceClusterStarts[k] = clusterStart
      }
    }
    const charSourceClusters = Array.from(sourceClusterStarts)
    if (this.tableManager.silf !== null) {
      const shaped = shapeGraphite(this, cps, {
        language,
        rightToLeft: isRightToLeftScriptTag(script) || cps.some(isRightToLeftCodePoint),
        features: options?.graphiteFeatures,
        justification: options?.graphiteJustification,
      })
      const flags = new Array<number>(shaped.length)
      for (let i = 0; i < shaped.length; i++) {
        const glyph = shaped[i]!
        flags[i] = (isDefaultIgnorable(cps[glyph.graphite.original]!)
          ? GLYPH_FLAG_DEFAULT_IGNORABLE
          : 0) | (glyph.graphite.substituted ? GLYPH_FLAG_SUBSTITUTED : 0)
      }
      hideDefaultIgnorableGlyphs(this, shaped, flags)
      return shaped
    }
    let hasCursiveJoining = false
    let hasRightToLeftScript = false
    let hasSinhala = false
    let hasSaraAm = false
    let hasThai = false
    let hasMarkRun = false
    let hasMark = false
    let complexScript: ComplexScriptClass = COMPLEX_NONE
    let prevWasMark = false
    for (let k = 0; k < cps.length; k++) {
      const cp = cps[k]!
      if (cp < 0x0300) {
        prevWasMark = false
        continue
      }
      if (!hasCursiveJoining && isCursiveJoiningChar(cp)) hasCursiveJoining = true
      if (!hasRightToLeftScript && isRightToLeftCodePoint(cp)) hasRightToLeftScript = true
      if (!hasSinhala && getUnicodeScript(cp) === 'Sinhala') hasSinhala = true
      if (!hasSaraAm && isSaraAm(cp)) hasSaraAm = true
      if (!hasThai && getUnicodeScript(cp) === 'Thai') hasThai = true
      if (complexScript === COMPLEX_NONE) {
        if (isIndicChar(cp)) {
          // Sinhala (U+0D80-U+0DFF) is now handled by the Indic shaper (pre-base
          // vowel reordering + split-matra decomposition).
          complexScript = COMPLEX_INDIC
        } else if (isTibetanChar(cp)) {
          complexScript = COMPLEX_TIBETAN
        } else if (isKhmerChar(cp)) {
          complexScript = COMPLEX_KHMER
        } else if (isMyanmarChar(cp)) {
          complexScript = COMPLEX_MYANMAR
        } else if (isHangulChar(cp)) {
          complexScript = COMPLEX_HANGUL
        } else if (isUseScriptChar(cp)) {
          complexScript = COMPLEX_USE
        }
      }
      if (getModifiedCombiningClass(cp) !== 0) {
        // Runs of two or more combining marks need canonical reordering.
        if (prevWasMark) hasMarkRun = true
        prevWasMark = true
        hasMark = true
      } else {
        prevWasMark = false
      }
    }

    const gsub = this.tableManager.gsub
    const gdef = this.tableManager.gdef
    const requestedFeatures = options?.features ?? (hasSinhala ? SINHALA_SHAPING_FEATURES : undefined)
    const jstfGsubModifications = getJstfGsubLookupModifications(options)

    // HarfBuzz routes a USE-list script to the Universal Shaping Engine only
    // when the font's GSUB exposes a real (non-DFLT/latn) script for it;
    // otherwise it falls back to the default shaper, which does no syllable
    // analysis or broken-cluster dotted-circle insertion (hb_ot_shaper_categorize).
    // Mirror that: a font whose GSUB only carries DFLT for this script drops to
    // the non-complex path. When the caller passes no script tag (the layout /
    // measure path), derive it from the code points so the decision still holds.
    if (complexScript === COMPLEX_USE && gsub !== null) {
      let useTag = script
      if (useTag === null) {
        for (let k = 0; k < cps.length; k++) {
          const t = deriveUseScriptTag(cps[k]!)
          if (t !== null) { useTag = t; break }
        }
      }
      if (useTag !== null && !gsub.hasScript(useTag)) complexScript = COMPLEX_NONE
    }

    // Same gating for the Indic and Myanmar shapers (hb_ot_shaper_categorize):
    // HarfBuzz picks the specific shaper based on the OT script it *chooses* for
    // the run. Script selection tries the script's real tags, then falls back to
    // 'DFLT'/'latn'; the chosen tag decides the shaper. So the specific shaper is
    // dropped only when the chosen tag is DFLT/latn (i.e. the font has a
    // DFLT/latn script but not the real one). A font that declares neither the
    // real script tags NOR DFLT/latn still routes to the specific shaper (the
    // requested tag is chosen) — e.g. Arial Unicode has no Bengali and no DFLT
    // GSUB script, so Bengali still uses the Indic shaper; NotoSansMyanmar has a
    // DFLT script, so Myanmar drops to the default shaper.
    if (gsub !== null && (complexScript === COMPLEX_MYANMAR || complexScript === COMPLEX_INDIC)) {
      const hasDfltOrLatn = gsub.hasScript('DFLT') || gsub.hasScript('latn')
      if (complexScript === COMPLEX_MYANMAR) {
        // 'mym2' → Myanmar shaper; the old 'mymr' tag (and DFLT/latn) → default.
        if (!gsub.hasScript('mym2') && (gsub.hasScript('mymr') || hasDfltOrLatn)) {
          complexScript = COMPLEX_NONE
        }
      } else {
        const tags = indicOtScriptTags(script, cps)
        if (tags !== null && !gsub.hasScript(tags[0]) && !gsub.hasScript(tags[1]) && hasDfltOrLatn) {
          complexScript = COMPLEX_NONE
        }
      }
    }

    // A font that carries a 'morx' table is shaped through AAT, not GSUB.
    // HarfBuzz's _hb_apply_morx prefers morx whenever the font has one and the
    // run is horizontal (or the font has no GSUB at all): morx applies for every
    // script, replacing the OpenType substitution stage and the OT complex-script
    // pipeline, and positioning goes through kerx/kern instead of GPOS. The morx
    // state machines do their own reordering, so only Unicode normalization runs
    // first, then cmap → morx → kerx. This matches Apple's shaping, which can
    // differ from the font's own GSUB (e.g. Bangla MN's split-O pre-base form,
    // or fi/fl/ff ligatures the GSUB does not form).
    const applyMorx = this.tableManager.morx !== null &&
      (direction === 'horizontal' || gsub === null)
    const usesAatSubstitution = applyMorx || (gsub === null && this.tableManager.mort !== null)
    const explicitLanguageFeature = options?.aatFeatures !== undefined && hasAatFeatureType(options.aatFeatures, 39)
    const aatLanguageTags = usesAatSubstitution && (language !== null || explicitLanguageFeature)
      ? this.tableManager.ltag
      : null
    const aatFeatureNames = usesAatSubstitution && (options?.aatFeatures !== undefined || aatLanguageTags !== null)
      ? this.tableManager.feat
      : null
    const aatFeatureSelectors = usesAatSubstitution
      ? buildAatFeatureSelectors(
        aatFeatureNames,
        aatLanguageTags,
        options?.features,
        options?.aatFeatures,
        language,
      )
      : undefined

    // The Indic AAT path needs script-specific normalization (decompose +
    // font-aware recompose, including split matras) before morx runs.
    const useMorxForIndic = applyMorx && complexScript === COMPLEX_INDIC

    // Complex-script shapers handle their own normalization, syllable
    // analysis and reordering; they replace steps 1b-2 entirely. They are
    // bypassed when morx drives shaping.
    const useComplexShaper = complexScript !== COMPLEX_NONE &&
      direction === 'horizontal' && gsub !== null && !applyMorx

    // Unicode vowel constraints: insert a dotted circle into prohibited
    // independent-vowel + vowel-sign sequences before shaping. Applies to the
    // Indic and USE scripts on the OpenType (GSUB) path; the AAT morx path is
    // skipped because HarfBuzz falls back to a minimal shaper with no such
    // preprocessing when morx drives shaping (the font's morx supplies its own
    // dotted circle). Downstream steps rebuild clusters from the longer cps run.
    if ((complexScript === COMPLEX_INDIC || complexScript === COMPLEX_USE) && !applyMorx) {
      const sourceCounts = new Array<number>(cps.length).fill(1)
      applyVowelConstraints(cps, sourceCounts, charSourceClusters)
    }

    // 1b. Code-point preprocessing: Thai/Lao sara am decomposition, then
    // combining-mark reordering by modified combining class (the order used
    // by shaping engines: decompositions first, then the canonical reorder).
    let charClusters: number[] | null = null
    if (useMorxForIndic) {
      // Indic normalization for the AAT path: decompose composites and reorder
      // marks, then recompose — including split matras — to the precomposed
      // forms Apple's morx expects (HarfBuzz feeds morx the recomposed run).
      charClusters = new Array(cps.length)
      for (let k = 0; k < cps.length; k++) charClusters[k] = 1
      const indicCtx: ShapeContext = {
        font: this,
        gsub: gsub!,
        gdef,
        script,
        language,
        userFeatures: options?.features ?? null,
        featureSettings: options?.featureSettings ?? null,
        normalizedCoords: this.tableManager.normalizedCoords,
        jstfLookupModifications: jstfGsubModifications,
      }
      normalizeIndic(indicCtx, cps, charClusters, true, charSourceClusters)
    } else if (hasSaraAm || hasMarkRun || (hasMark && !useComplexShaper)) {
      charClusters = new Array(cps.length)
      for (let k = 0; k < cps.length; k++) charClusters[k] = 1
      // SARA AM decomposition is an OpenType (GSUB) Thai-shaper step. AAT 'morx'
      // fonts ligate the undecomposed sara am directly, matching HarfBuzz, so
      // decomposition is skipped when morx drives shaping (or there is no GSUB).
      if (hasSaraAm && gsub !== null && !applyMorx) preprocessThaiLao(cps, charClusters, charSourceClusters)
      if (hasMarkRun && !useComplexShaper) reorderMarkRuns(cps, charClusters, charSourceClusters)
      // Font-aware canonical composition (NFC): recompose base + combining mark
      // into a precomposed code point when the font has a glyph for it, matching
      // the default OpenType shaper. Complex shapers do their own composition.
      if (hasMark && !useComplexShaper) composeMarksToFontGlyphs(this, cps, charClusters, charSourceClusters)
    }

    // Thai PUA fallback shaping: a font with no Thai GSUB script positions tone
    // marks and below-base vowels through pre-encoded PUA glyphs (HarfBuzz's
    // preprocess_text_thai found_script fallback). Runs after SARA AM
    // decomposition, remapping code points 1:1 before cmap. Gated to Thai (not
    // Lao) and to fonts lacking a 'thai' GSUB script.
    if (hasThai && !applyMorx && (gsub === null || !gsub.hasScript('thai'))) {
      thaiPuaShaping(cps, cp => this.getGlyphId(cp) !== 0)
    }

    // 1c. codepoints → glyphIds, folding variation selector sequences
    // (cmap format 14): a base character followed by a variation selector
    // maps through the UVS subtable and consumes the selector.
    let glyphIds: number[] = []
    let glyphFlags: number[] = []
    // Per-output-glyph source (baseCps) cluster index, tracked through the AAT
    // morx pipeline; used by fallback mark positioning. Null on non-morx paths.
    let glyphClusters: number[] | null = null
    // morx output with deleted glyphs kept as 0xFFFF markers. AAT 'kern' state
    // machines position marks over this buffer (the markers keep state
    // transitions aligned with HarfBuzz). Null when the morx path had no
    // deletions or was not taken.
    let glyphsWithDeletions: number[] | null = null
    // Per-slot source cluster indices aligned with glyphsWithDeletions, so a
    // deleted slot's source character (and its mark-ness) is still known
    // during pair kerning.
    let clustersWithDeletions: number[] | null = null
    const initialClusters: number[] = []
    const initialSourceClusters: number[] = []
    const baseCps: number[] = []
    const verticalSourceCps: number[] = []
    const verticalSourceGlyphIds: number[] = []
    let hasVariationSelector = false
    if (!useComplexShaper) {
      for (let k = 0; k < cps.length; k++) {
        const cp = cps[k]!
        const next = k + 1 < cps.length ? cps[k + 1]! : -1
        const cluster = charClusters !== null ? charClusters[k]! : 1
        if (isVariationSelector(next)) {
          const glyphId = this.getGlyphIdWithVariation(cp, next)
          const sourceCount = cluster + (charClusters !== null ? charClusters[k + 1]! : 1)
          glyphIds.push(glyphId)
          glyphFlags.push(isDefaultIgnorable(cp) ? GLYPH_FLAG_DEFAULT_IGNORABLE : 0)
          initialClusters.push(sourceCount)
          initialSourceClusters.push(charSourceClusters[k]!)
          for (let source = 0; source < sourceCount; source++) {
            verticalSourceCps.push(cp)
            verticalSourceGlyphIds.push(glyphId)
          }
          hasVariationSelector = true
          k++
        } else {
          const glyphId = this.getGlyphId(cp)
          glyphIds.push(glyphId)
          glyphFlags.push(isDefaultIgnorable(cp) ? GLYPH_FLAG_DEFAULT_IGNORABLE : 0)
          initialClusters.push(cluster)
          initialSourceClusters.push(charSourceClusters[k]!)
          for (let source = 0; source < cluster; source++) {
            verticalSourceCps.push(cp)
            verticalSourceGlyphIds.push(glyphId)
          }
        }
        baseCps.push(cp)
      }
    }

    // 2. GSUB substitution (track ligature components)
    // Falls back to morx → mort when GSUB is absent
    let ligatureComponents: Map<number, number> | null = null
    // Per-output-glyph source-component counts derived from AAT morx cluster
    // tracking (a ligature covers >1 source glyph), used to map glyphs back to
    // their source characters for ToUnicode.
    let clusterComponentCounts: number[] | null = null
    let ligatureMarkComponents: Map<number, number> | null = null
    let arabicClusters: Uint16Array | null = null
    let outputSourceClusters: number[] | null = null
    if (gsub && useComplexShaper) {
      // Complex-script pipeline: normalization → classification → syllables
      // → staged GSUB with reordering between the stages.
      const ctx: ShapeContext = {
        font: this,
        gsub,
        gdef,
        script,
        language,
        userFeatures: options?.features ?? null,
        featureSettings: options?.featureSettings ?? null,
        normalizedCoords: this.tableManager.normalizedCoords,
        jstfLookupModifications: jstfGsubModifications,
      }
      let shaped: { glyphIds: number[], clusters: number[], sourceClusters: number[], flags: number[] }
      if (complexScript === COMPLEX_INDIC) {
        shaped = shapeIndic(ctx, cps, charClusters, charSourceClusters)
      } else if (complexScript === COMPLEX_KHMER) {
        shaped = shapeKhmer(ctx, cps, charClusters, charSourceClusters)
      } else if (complexScript === COMPLEX_MYANMAR) {
        shaped = shapeMyanmar(ctx, cps, charClusters, charSourceClusters)
      } else if (complexScript === COMPLEX_HANGUL) {
        shaped = shapeHangul(ctx, cps, charClusters, charSourceClusters)
      } else if (complexScript === COMPLEX_USE) {
        shaped = shapeUse(ctx, cps, charClusters, charSourceClusters)
      } else {
        shaped = shapeTibetan(ctx, cps, charClusters, charSourceClusters)
      }
      if (jstfGsubModifications !== null && jstfGsubModifications.enabled.length > 0) {
        const buffer = {
          glyphs: shaped.glyphIds,
          masks: null,
          clusters: shaped.clusters,
          sourceClusters: shaped.sourceClusters,
          syllables: null,
          aux: null,
          flags: shaped.flags,
        }
        gsub.applyLookupsToShapingBuffer(buffer, jstfGsubModifications.enabled, gdef)
        shaped = {
          glyphIds: buffer.glyphs,
          clusters: buffer.clusters,
          sourceClusters: buffer.sourceClusters!,
          flags: buffer.flags,
        }
      }
      glyphIds = shaped.glyphIds
      glyphFlags = shaped.flags
      arabicClusters = Uint16Array.from(shaped.clusters)
      outputSourceClusters = shaped.sourceClusters
      for (let i = 0; i < arabicClusters.length; i++) {
        if (arabicClusters[i]! > 1) {
          if (ligatureComponents === null) ligatureComponents = new Map<number, number>()
          ligatureComponents.set(i, arabicClusters[i]!)
        }
      }
    } else if (useMorxForIndic) {
      // AAT Indic: the normalized (recomposed) code points were already mapped
      // to glyphs in step 1c; morx does substitution and its own reordering.
      const morx = this.tableManager.morx!
      const preMorxGlyphCount = glyphIds.length
      const identity = new Array<number>(glyphIds.length)
      for (let gi = 0; gi < identity.length; gi++) identity[gi] = gi
      const tracked = morx.applySubstitutionsTracked(
        { glyphs: glyphIds, clusters: identity, flags: glyphFlags },
        aatFeatureSelectors,
        false,
        { boundary: options?.aatBoundary, vertical: direction === 'vertical', rightToLeft: false },
      )
      glyphIds = tracked.glyphs
      glyphFlags = tracked.flags!
      glyphClusters = tracked.clusters
      glyphsWithDeletions = tracked.glyphsWithDeletions ?? null
      clustersWithDeletions = tracked.clustersWithDeletions ?? null
      // Per-glyph source-component counts, so ToUnicode maps a morx-formed
      // conjunct back to all of its source code points (not just the first).
      clusterComponentCounts = deriveComponentCountsFromClusters(glyphClusters, preMorxGlyphCount)
    } else if (applyMorx) {
      // General AAT path: a font that carries 'morx' shapes through it for every
      // non-Indic script (HarfBuzz's _hb_apply_morx), including plain Latin whose
      // fi/fl/ff ligatures live in morx rather than GSUB. Track source clusters
      // through morx so fallback mark positioning can find each mark's cluster base.
      const morx = this.tableManager.morx!
      const preMorxGlyphCount = glyphIds.length
      const identity = new Array<number>(glyphIds.length)
      for (let gi = 0; gi < identity.length; gi++) identity[gi] = gi
      const tracked = morx.applySubstitutionsTracked(
        { glyphs: glyphIds, clusters: identity, flags: glyphFlags },
        aatFeatureSelectors,
        hasRightToLeftScript || isRightToLeftScriptTag(script),
        {
          boundary: options?.aatBoundary,
          vertical: direction === 'vertical',
          rightToLeft: hasRightToLeftScript || isRightToLeftScriptTag(script),
        },
      )
      glyphIds = tracked.glyphs
      glyphFlags = tracked.flags!
      glyphClusters = tracked.clusters
      glyphsWithDeletions = tracked.glyphsWithDeletions ?? null
      clustersWithDeletions = tracked.clustersWithDeletions ?? null
      clusterComponentCounts = deriveComponentCountsFromClusters(glyphClusters, preMorxGlyphCount)
    } else if (gsub) {
      const vertFeatures = direction === 'vertical'
        ? buildVerticalGsubFeatures(gsub, requestedFeatures, script, language, this.tableManager.normalizedCoords)
        : requestedFeatures

      if (hasCursiveJoining || hasVariationSelector) {
        // Cluster-exact path: cursive joining and/or variation selector
        // sequences need per-glyph cluster tracking. For joining scripts, each
        // character's joining position selects the positional features
        // (isol/fina/medi/init); for plain text with variation selectors the
        // positions are all zero, so only the general features apply.
        // Other texts pay no cost. Cluster tracking is exact on this path.
        const positions = hasCursiveJoining
          ? computeJoiningPositions(baseCps)
          : new Uint8Array(baseCps.length)
        const clusterInit = new Uint16Array(initialClusters)
        const joined = gsub.applyJoiningSubstitutions(
          glyphIds,
          positions,
          vertFeatures ?? null,
          script ?? inferCursiveJoiningScript(baseCps),
          language,
          gdef,
          clusterInit,
          this.tableManager.normalizedCoords,
          jstfGsubModifications,
          Uint8Array.from(glyphFlags),
          Uint32Array.from(initialSourceClusters),
          options?.featureSettings ?? null,
        )
        glyphIds = joined.glyphIds
        glyphFlags = Array.from(joined.flags)
        arabicClusters = joined.clusters
        outputSourceClusters = Array.from(joined.sourceClusters)

        // GPOS ligature component counts from the exact cluster sizes
        for (let i = 0; i < arabicClusters.length; i++) {
          if (arabicClusters[i]! > 1) {
            if (ligatureComponents === null) ligatureComponents = new Map<number, number>()
            ligatureComponents.set(i, arabicClusters[i]!)
          }
        }
      } else {
        // Automatic fractions (C3.4): digits around a FRACTION SLASH (U+2044)
        // get numr (numerator) / dnom (denominator) / frac, applied with
        // per-glyph masks before the general substitutions.
        if (baseCps.length === glyphIds.length && direction !== 'vertical') {
          const fractioned = applyAutoFraction(gsub, glyphIds, glyphFlags, baseCps, script, language, gdef, this.tableManager.normalizedCoords)
          if (fractioned !== null) {
            glyphIds = fractioned.glyphIds
            glyphFlags = fractioned.glyphFlags
          }
        }
        const substituted = gsub.applySubstitutionsWithMetadata(
          glyphIds,
          vertFeatures ?? null,
          script,
          language,
          gdef,
          this.tableManager.normalizedCoords,
          jstfGsubModifications,
          Uint8Array.from(glyphFlags),
          Uint32Array.from(initialSourceClusters),
          options?.featureSettings ?? null,
        )
        glyphIds = substituted.glyphIds
        glyphFlags = Array.from(substituted.flags)
        ligatureMarkComponents = substituted.ligatureMarkComponents
        // Source-component count per output glyph, tracked through the GSUB
        // buffer (ligatures sum, decompositions keep the count on the first
        // output glyph). Drives ToUnicode so a decomposed presentation form
        // (U+FB01 -> f + i) maps back to its single source code point.
        clusterComponentCounts = Array.from(substituted.clusters)
        outputSourceClusters = Array.from(substituted.sourceClusters)

        // Build ligature component map: glyphIndex → componentCount
        const ligCompCounts = gsub.getLigatureComponentCounts()
        if (ligCompCounts.size > 0) {
          ligatureComponents = new Map<number, number>()
          for (let i = 0; i < glyphIds.length; i++) {
            const count = ligCompCounts.get(glyphIds[i]!)
            if (count !== undefined) {
              ligatureComponents.set(i, count)
            }
          }
        }
      }
    } else {
      // Legacy AAT fallback: a font with no GSUB and no 'morx' but a 'mort'
      // (pre-morx AAT substitution). Fonts with 'morx' took the applyMorx branch.
      const mort = this.tableManager.mort
      if (mort) {
        const preMortGlyphCount = glyphIds.length
        const identity = new Array<number>(glyphIds.length)
        for (let gi = 0; gi < identity.length; gi++) identity[gi] = gi
        const tracked = mort.applySubstitutionsTracked(
          { glyphs: glyphIds, clusters: identity, flags: glyphFlags },
          aatFeatureSelectors,
          {
            boundary: options?.aatBoundary,
            vertical: direction === 'vertical',
            rightToLeft: hasRightToLeftScript || isRightToLeftScriptTag(script),
          },
        )
        glyphIds = tracked.glyphs
        glyphFlags = tracked.flags!
        glyphClusters = tracked.clusters
        glyphsWithDeletions = tracked.glyphsWithDeletions ?? null
        clustersWithDeletions = tracked.clustersWithDeletions ?? null
        clusterComponentCounts = deriveComponentCountsFromClusters(glyphClusters, preMortGlyphCount)
      }
    }

    const gpos = useMorxForIndic ? null : this.tableManager.gpos

    // OpenType shapers have three GDEF-mark advance policies. Myanmar, USE,
    // Tibetan, and Sinhala zero marks before GPOS; the default, Arabic, Thai,
    // and Hebrew shapers zero them after GPOS; Indic, Khmer, and Hangul keep
    // their advances. The timing matters because contextual/cursive positioning
    // observes the advances that exist while its lookups run. AAT substitution
    // keeps its native advances and is positioned by its own tables.
    let zeroedMarks: Uint8Array | null = null
    let zeroMarksBeforeGpos = false
    const keepsMarkAdvances = !hasSinhala && (
      complexScript === COMPLEX_INDIC
      || complexScript === COMPLEX_KHMER
      || complexScript === COMPLEX_HANGUL
    )
    const hasNativePositioning = gpos !== null
      || this.tableManager.kern !== null
      || this.tableManager.kerx !== null
    if (!applyMorx && gdef !== null && !keepsMarkAdvances
      && (gpos !== null || !hasNativePositioning)) {
      zeroMarksBeforeGpos = hasSinhala
        || complexScript === COMPLEX_MYANMAR
        || complexScript === COMPLEX_USE
        || complexScript === COMPLEX_TIBETAN
      zeroedMarks = new Uint8Array(glyphIds.length)
      for (let i = 0; i < glyphIds.length; i++) {
        if (gdef.getGlyphClass(glyphIds[i]!) === 3) zeroedMarks[i] = 1
      }
    }

    // 3. GPOS positioning. HarfBuzz chooses the positioning engine independently
    // of morx substitution: it uses GPOS whenever the font has it, and only an
    // Indic AAT font (shaped and reordered by morx) positions via kerx/kern
    // instead. A non-Indic font with morx still positions through GPOS.
    // HarfBuzz applies the legacy 'kern'/'kerx' tables only when GPOS did not
    // kern the run: a font whose GPOS has no 'kern' feature (e.g. Arial Black)
    // still uses its 'kern' table, while one whose GPOS kerns (e.g. Athelas)
    // ignores the table entirely. Gate every legacy-kern path on this.
    const useLegacyKern = gpos === null || !gpos.hasKernFeature
    let posAdj: PositionAdjustment[] | null = null
    if (gpos) {
      // Base advances enable absolute cursive-attachment advances; the GPOS
      // direction drives the cursive connection geometry (logical order)
      const gposDirection = direction === 'vertical'
        ? 'ttb'
        : (hasCursiveJoining || hasRightToLeftScript || isRightToLeftScriptTag(script) ? 'rtl' : 'ltr')
      const baseAdvances: number[] = new Array(glyphIds.length)
      for (let i = 0; i < glyphIds.length; i++) {
        baseAdvances[i] = zeroMarksBeforeGpos && zeroedMarks![i] === 1
          ? 0
          : direction === 'vertical'
            ? this.getAdvanceHeight(glyphIds[i]!)
            : this.getAdvanceWidth(glyphIds[i]!)
      }
      const gposFeatures = buildGposFeatures(requestedFeatures, direction === 'vertical')
      const jstfPriority = options?.jstf?.priority
      if (jstfPriority === undefined) {
        posAdj = gpos.getPositionAdjustments(
          glyphIds, script, language, gposFeatures, ligatureComponents, gdef,
          gposDirection, baseAdvances, this.tableManager.normalizedCoords, options?.ppem,
          ligatureMarkComponents,
          zeroedMarks !== null && !zeroMarksBeforeGpos,
          options?.featureSettings ?? null,
          outputSourceClusters ?? glyphClusters ?? initialSourceClusters,
          this,
        )
      } else {
        const extending = options!.jstf!.mode === 'extend'
        const enabled = extending
          ? jstfPriority.gposExtensionEnableLookups
          : jstfPriority.gposShrinkageEnableLookups
        const disabled = extending
          ? jstfPriority.gposExtensionDisableLookups
          : jstfPriority.gposShrinkageDisableLookups
        const selected = gpos.getFeatureLookupIndices(
          gposFeatures ?? new Set(['kern', 'mark', 'mkmk', 'curs', 'dist', 'abvm', 'blwm']),
          script, language, this.tableManager.normalizedCoords,
        )
        const lookupPlan = mergeJstfLookupPlan(selected, enabled, disabled)
        posAdj = gpos.getPositionAdjustmentsForLookups(
          glyphIds, lookupPlan, ligatureComponents, gdef, gposDirection, baseAdvances,
          this.tableManager.normalizedCoords, options?.ppem, ligatureMarkComponents,
          zeroedMarks !== null && !zeroMarksBeforeGpos,
          this,
        )
      }
    }

    // 4. Build result
    const result: ShapedGlyph[] = []
    const kerxTableForPositioning = this.tableManager.kerx
    const normalizedCoords = this.tableManager.normalizedCoords
    const aatTupleScalars = normalizedCoords !== null && this.tableManager.gvar !== null
      ? this.tableManager.gvar.getSharedTupleScalars(normalizedCoords)
      : undefined
    // AAT kerx format 1 contextual kerning runs over the whole glyph run (a
    // state machine), producing one x-advance adjustment per position. Only AAT
    // fonts carry a kerx table, so this is skipped for everyone else. Like every
    // legacy kern/kerx path it is a GPOS fallback: HarfBuzz applies it only when
    // the run was not positioned by GPOS.
    const kerxContextual = useLegacyKern && kerxTableForPositioning !== null
      ? kerxTableForPositioning.applyContextualPositioning(glyphIds, direction, aatTupleScalars, options?.aatBoundary)
      : null
    // Legacy AAT 'kern' format-1 state machine positioning (advance + x/y offset
    // per glyph). Positions marks in AAT fonts that carry a 'kern' but no
    // GPOS/kerx (e.g. macOS Mishafi). The state machine runs over the
    // morx-deletion-marker-preserved buffer so its transitions match HarfBuzz;
    // the resulting deltas are mapped back onto the visible (marker-free) glyphs.
    // Skipped when GPOS positioned the run: HarfBuzz ignores the 'kern' table
    // entirely once a font has GPOS (the table is a pre-GPOS fallback).
    let kernAdvance: number[] | null = null
    let kernYAdvance: number[] | null = null
    let kernXOffset: number[] | null = null
    let kernYOffset: number[] | null = null
    if (useLegacyKern && this.tableManager.kern !== null) {
      const isRtlKern = hasCursiveJoining || hasRightToLeftScript || isRightToLeftScriptTag(script)
      const buffer = glyphsWithDeletions ?? glyphIds
      const kd = this.tableManager.kern.applyContextualPositioning(
        buffer, direction, isRtlKern, aatTupleScalars, options?.aatBoundary,
      )
      if (glyphsWithDeletions === null) {
        kernAdvance = kd.xAdvance
        kernYAdvance = kd.yAdvance
        kernXOffset = kd.xOffset
        kernYOffset = kd.yOffset
      } else {
        // Map marker-preserved indices onto marker-free (result) indices; a
        // deleted glyph's delta is discarded along with the glyph itself.
        kernAdvance = new Array<number>(glyphIds.length).fill(0)
        kernYAdvance = new Array<number>(glyphIds.length).fill(0)
        kernXOffset = new Array<number>(glyphIds.length).fill(0)
        kernYOffset = new Array<number>(glyphIds.length).fill(0)
        let ri = 0
        for (let bi = 0; bi < buffer.length; bi++) {
          if (buffer[bi] === 0xFFFF) continue
          kernAdvance[ri] = kd.xAdvance[bi]!
          kernYAdvance[ri] = kd.yAdvance[bi]!
          kernXOffset[ri] = kd.xOffset[bi]!
          kernYOffset[ri] = kd.yOffset[bi]!
          ri++
        }
      }
    }
    const base = this.tableManager.base
    const baseResolutionContext: BaseResolutionContext | undefined = base === null ? undefined : {
      ppem: options?.ppem,
      unitsPerEm: this.metrics.unitsPerEm,
      controlPointResolver: this,
    }
    const baseScripts = base !== null ? buildBaseScripts(cps, script) : []
    let referenceBaselineTag: string | null = null
    let referenceBaselineCoordinate = 0
    let baselineOffsetCache: Map<string, number> | null = null
    if (base !== null && baseScripts.length > 0) {
      let referenceScript = script ?? baseScripts[0]!
      let referenceBaseline = base.getDefaultBaseline(
        referenceScript,
        language ?? undefined,
        direction,
        this.tableManager.normalizedCoords ?? undefined,
        baseResolutionContext,
      )
      if (referenceBaseline === null && script !== null) {
        referenceScript = baseScripts[0]!
        referenceBaseline = base.getDefaultBaseline(
          referenceScript,
          language ?? undefined,
          direction,
          this.tableManager.normalizedCoords ?? undefined,
          baseResolutionContext,
        )
      }
      if (referenceBaseline !== null) {
        referenceBaselineTag = referenceBaseline.tag
        referenceBaselineCoordinate = referenceBaseline.coordinate
        baselineOffsetCache = new Map<string, number>()
      }
    }
    // AAT pair kerning (kerx format 0/2 + legacy kern pairs) applied the way
    // HarfBuzz's kern machine does: each non-mark glyph kerns with the next
    // non-mark glyph (LookupFlag::IgnoreMarks), the value split as kern1 → the
    // first glyph's x-advance and kern2 → the second glyph's x-advance AND
    // x-offset. Precomputed here (morx path only, where each glyph's source
    // category is known via glyphClusters/baseCps) so kern2's offset lands on the
    // right glyph — applying the whole value to the first advance misplaces marks
    // that sit between the pair.
    // Only on the true AAT positioning path: HarfBuzz applies kerx / legacy kern
    // pair kerning only when GPOS did not position the run. A font that carries
    // GPOS (even alongside morx, e.g. a Latin morx font) is positioned by GPOS,
    // and its legacy kern/kerx pairs are ignored — applying them would double the
    // kerning GPOS already produced.
    let pairKernXAdvance: number[] | null = null
    let pairKernYAdvance: number[] | null = null
    let pairKernXOffset: number[] | null = null
    let pairKernYOffset: number[] | null = null
    if (useLegacyKern && (this.tableManager.kerx !== null || this.tableManager.kern !== null)) {
      pairKernXAdvance = new Array<number>(glyphIds.length).fill(0)
      pairKernYAdvance = new Array<number>(glyphIds.length).fill(0)
      pairKernXOffset = new Array<number>(glyphIds.length).fill(0)
      pairKernYOffset = new Array<number>(glyphIds.length).fill(0)
      const kerxTable = this.tableManager.kerx
      const kernTable = this.tableManager.kern
      // Run over the buffer as HarfBuzz's kern machine sees it: morx-deleted
      // glyphs are removed only after positioning, so their slots still count.
      // A slot is skipped as a mark iff its source character has the
      // synthesized mark glyph class (general category Mn and not
      // default-ignorable); a deleted slot whose character is not such a mark
      // participates as a glyph no pair table covers, blocking the pair
      // across it.
      const bufGlyphs = glyphsWithDeletions ?? glyphIds
      const bufClusters = glyphClusters === null
        ? null
        : glyphsWithDeletions !== null ? clustersWithDeletions! : glyphClusters
      // Compacted result index per buffer slot (-1 for deleted slots).
      const slotIndex = new Array<number>(bufGlyphs.length)
      let compacted = 0
      for (let k = 0; k < bufGlyphs.length; k++) slotIndex[k] = bufGlyphs[k] === 0xFFFF ? -1 : compacted++
      let idx = 0
      while (idx < bufGlyphs.length) {
        // Next slot whose source character is not a synthesized mark.
        let j = idx + 1
        while (j < bufGlyphs.length) {
          const isMark = bufClusters !== null
            ? isNonspacingMark(baseCps[bufClusters[j]!]!) && !isDefaultIgnorable(baseCps[bufClusters[j]!]!)
            : gdef?.getGlyphClass(bufGlyphs[j]!) === 3
          if (!isMark) break
          j++
        }
        if (j >= bufGlyphs.length) break
        let pk = 0
        let crossStream: number | null = null
        if (bufGlyphs[idx]! !== 0xFFFF && bufGlyphs[j]! !== 0xFFFF) {
          if (kerxTable !== null) {
            const adjustment = kerxTable.getPairAdjustment(
              bufGlyphs[idx]!, bufGlyphs[j]!, direction, aatTupleScalars,
            )
            pk = adjustment.advance
            crossStream = adjustment.crossStream
          }
          if (kernTable !== null && pk === 0 && crossStream === null) {
            const adjustment = kernTable.getPairAdjustment(
              bufGlyphs[idx]!, bufGlyphs[j]!, direction, aatTupleScalars,
              options?.trackingAdjustment ?? 0,
            )
            pk = adjustment.advance
            crossStream = adjustment.crossStream
          }
        }
        if (pk !== 0) {
          const kern1 = pk >> 1
          const kern2 = pk - kern1
          if (direction === 'horizontal') {
            pairKernXAdvance[slotIndex[idx]!]! += kern1
            pairKernXAdvance[slotIndex[j]!]! += kern2
            pairKernXOffset[slotIndex[j]!]! += kern2
          } else {
            pairKernYAdvance[slotIndex[idx]!]! += kern1
            pairKernYAdvance[slotIndex[j]!]! += kern2
            pairKernYOffset[slotIndex[j]!]! += kern2
          }
        }
        if (crossStream !== null) {
          if (direction === 'horizontal') pairKernYOffset[slotIndex[j]!] = crossStream
          else pairKernXOffset[slotIndex[j]!] = crossStream
        }
        idx = j
      }
    }
    let cpCursor = 0
    let sourceCluster = 0
    let previousSourceCluster = 0
    let resolvedSourceClusters: number[] | null = null
    if (outputSourceClusters !== null && useComplexShaper && complexScript !== COMPLEX_HANGUL) {
      resolvedSourceClusters = new Array<number>(glyphIds.length)
      let cursor = 0
      for (let i = 0; i < glyphIds.length; i++) {
        const count = arabicClusters !== null
          ? arabicClusters[i]!
          : (clusterComponentCounts !== null ? clusterComponentCounts[i]! : (ligatureComponents?.get(i) ?? 1))
        if (count === 0) {
          resolvedSourceClusters[i] = outputSourceClusters[i]!
        } else if (cursor > 0 && (
          continuesShapingCluster(sourceCodePoints[cursor]!) ||
          (complexScript === COMPLEX_USE && sourceClusterStarts[cursor] !== cursor)
        )) {
          resolvedSourceClusters[i] = resolvedSourceClusters[i - 1]!
        } else {
          resolvedSourceClusters[i] = cursor
        }
        cursor += count
      }
      for (let i = 1; i < resolvedSourceClusters.length; i++) {
        const cluster = resolvedSourceClusters[i]!
        if (cluster >= resolvedSourceClusters[i - 1]!) continue
        let j = i - 1
        while (j >= 0 && resolvedSourceClusters[j]! > cluster) {
          resolvedSourceClusters[j] = cluster
          j--
        }
      }
    }
    let verticalSourceCursor = 0
    let previousVerticalRotation: 0 | 90 = 0
    let previousBaseScript = baseScripts[0] ?? (script ?? 'latn')
    const aatBaseline = base === null ? this.tableManager.bsln : null
    const aatReferenceBaseline = aatBaseline !== null && glyphIds.length > 0
      ? this.getAatBaselineCoordinate(glyphIds[0]!)
      : null
    for (let i = 0; i < glyphIds.length; i++) {
      const gid = glyphIds[i]!
      const adj = posAdj?.[i]
      const componentCount = arabicClusters !== null
        ? arabicClusters[i]!
        : (clusterComponentCounts !== null ? clusterComponentCounts[i]! : (ligatureComponents?.get(i) ?? 1))
      const glyphSourceCluster = resolvedSourceClusters?.[i]
        ?? outputSourceClusters?.[i]
        ?? (glyphClusters !== null
          ? (sourceClusterStarts[glyphClusters[i]!] ?? glyphClusters[i]!)
          : (componentCount > 0
            ? sourceClusterStarts[Math.min(sourceCluster, sourceClusterStarts.length - 1)] ?? 0
            : previousSourceCluster))
      previousSourceCluster = glyphSourceCluster
      let verticalRotation: 0 | 90 | undefined
      if (direction === 'vertical') {
        if (componentCount > 0 && verticalSourceCursor < verticalSourceCps.length) {
          const sourceCodePoint = verticalSourceCps[verticalSourceCursor]!
          const orientation = getUnicodeVerticalOrientation(sourceCodePoint)
          const transformed = gid !== verticalSourceGlyphIds[verticalSourceCursor]!
          previousVerticalRotation = orientation === 'R' || (orientation === 'Tr' && !transformed) ? 90 : 0
          verticalSourceCursor += componentCount
        }
        verticalRotation = previousVerticalRotation
      }
      let baseOffset = 0
      if (base !== null && referenceBaselineTag !== null && baselineOffsetCache !== null) {
        let glyphScript = previousBaseScript
        if (componentCount > 0 && cpCursor < baseScripts.length) {
          glyphScript = baseScripts[cpCursor]!
          previousBaseScript = glyphScript
          cpCursor += componentCount
        }
        const cached = baselineOffsetCache.get(glyphScript)
        if (cached !== undefined) {
          baseOffset = cached
        } else {
          const values = base.getBaselines(
            glyphScript,
            language ?? undefined,
            direction,
            this.tableManager.normalizedCoords ?? undefined,
            baseResolutionContext,
          )
          const coordinate = findBaselineCoordinate(values, referenceBaselineTag)
          baseOffset = coordinate === null ? 0 : referenceBaselineCoordinate - coordinate
          baselineOffsetCache.set(glyphScript, baseOffset)
        }
      } else if (aatReferenceBaseline !== null) {
        const coordinate = this.getAatBaselineCoordinate(gid)
        if (coordinate !== null) baseOffset = aatReferenceBaseline - coordinate
      }
      const advanceWidth = direction === 'horizontal' && !(zeroedMarks !== null && zeroedMarks[i] === 1)
        ? this.getAdvanceWidth(gid)
        : 0
      const advanceHeight = direction === 'vertical' && !(zeroedMarks !== null && zeroedMarks[i] === 1)
        ? this.getAdvanceHeight(gid)
        : 0
      const adjustZeroedMarkOffset = zeroedMarks !== null
        && zeroedMarks[i] === 1
        && gpos === null
        && !(hasCursiveJoining || hasRightToLeftScript || isRightToLeftScriptTag(script))
      const zeroedMarkXOffset = adjustZeroedMarkOffset && direction === 'horizontal'
        ? -this.getAdvanceWidth(gid)
        : 0
      const zeroedMarkYOffset = adjustZeroedMarkOffset && direction === 'vertical'
        ? -this.getAdvanceHeight(gid)
        : 0

      // Apply pair kerning from AAT kerx / legacy kern when GPOS did not produce
      // xAdvance. HarfBuzz's kern machine ignores marks (LookupFlag::IgnoreMarks):
      // a kerning pair is two consecutive non-mark glyphs, skipping any combining
      // marks between them. On the morx path each glyph's source category is known
      // via glyphClusters → baseCps, so marks are skipped exactly as HarfBuzz does
      // (otherwise a class kern meant for base–base wrongly widens base–mark).
      const lateZeroedMark = !zeroMarksBeforeGpos
        && zeroedMarks !== null
        && zeroedMarks[i] === 1
      const gposXAdv = lateZeroedMark ? 0 : (adj?.xAdvance ?? 0)
      const gposYAdv = lateZeroedMark ? 0 : (adj?.yAdvance ?? 0)
      let xAdvanceKern = 0
      let yAdvanceKern = 0
      let xOffsetKern = 0
      let yOffsetKern = 0
      if (pairKernXAdvance !== null) {
        // morx path: precomputed with mark-skipping and the kern1/kern2 split.
        xAdvanceKern = pairKernXAdvance[i]!
        yAdvanceKern = pairKernYAdvance![i]!
        xOffsetKern = pairKernXOffset![i]!
        yOffsetKern = pairKernYOffset![i]!
      }

      result.push({
        glyphId: gid,
        cluster: glyphSourceCluster,
        xOffset: (adj?.xPlacement ?? 0) + zeroedMarkXOffset + (direction === 'vertical' ? baseOffset : 0)
          + (kernXOffset !== null ? kernXOffset[i]! : 0) + xOffsetKern
          + (kerxContextual !== null ? kerxContextual.xOffset[i]! : 0),
        yOffset: (adj?.yPlacement ?? 0) + zeroedMarkYOffset + (direction === 'horizontal' ? baseOffset : 0)
          + (kernYOffset !== null ? kernYOffset[i]! : 0) + yOffsetKern
          + (kerxContextual !== null ? kerxContextual.yOffset[i]! : 0),
        xAdvance: advanceWidth + gposXAdv + xAdvanceKern
          + (kerxContextual !== null ? kerxContextual.xAdvance[i]! : 0)
          + (kernAdvance !== null ? kernAdvance[i]! : 0),
        yAdvance: advanceHeight + gposYAdv + yAdvanceKern
          + (kerxContextual !== null ? kerxContextual.yAdvance[i]! : 0)
          + (kernYAdvance !== null ? kernYAdvance[i]! : 0),
        componentCount,
        verticalRotation,
      })
      sourceCluster += componentCount
    }

    // AAT kerx format-4 attachment: position a glyph so its anchor/control point
    // aligns with the marked glyph's, resolving anchor indices through the 'ankr'
    // table (cursive-like mark attachment). HarfBuzz applies kerx only on the AAT
    // path, i.e. when the font has no GPOS to position marks itself, so this is
    // gated on the absence of GPOS to avoid double-positioning.
    if (this.tableManager.kerx !== null && (this.tableManager.gpos === null || useMorxForIndic)) {
      this.applyKerxAttachments(result, glyphsWithDeletions ?? glyphIds, direction, options?.aatBoundary)
    }

    // Fallback mark positioning: AAT fonts (morx path) with no mark-positioning
    // mechanism leave combining marks unpositioned. Center each such mark over
    // its cluster base (HarfBuzz fallback), scoped to nonspacing combining marks
    // and only when nothing else positioned it. Skipped when the font carries a
    // 'kern'/'kerx' table, whose state machines position marks themselves (e.g.
    // macOS Mishafi), or when GPOS positioned the run (e.g. a morx font that also
    // has GPOS mark attachment, like Khmer Sangam MN) — HarfBuzz runs the
    // fallback only when nothing else placed the marks.
    if (
      direction === 'horizontal'
      && glyphClusters !== null
      && gpos === null
      && this.tableManager.kern === null
      && this.tableManager.kerx === null
    ) {
      this.applyFallbackMarkPositioning(result, glyphClusters, baseCps)
    }

    // Default-ignorable provenance is carried by every substitution engine and
    // complex-shaper permutation, so this post-pass remains exact after
    // ligatures, decompositions, insertions, and reordering.
    hideDefaultIgnorableGlyphs(this, result, glyphFlags)

    return result
  }

  /**
   * Applies AAT 'kerx' format-4 attachment actions to the shaped run: each
   * action attaches a glyph to a marked earlier glyph by making a pair of points
   * coincide. Anchor actions (type 1) resolve the point coordinates through the
   * 'ankr' table; coordinate actions (type 2) carry them inline. The attaching
   * glyph is offset so its point lands on the marked glyph's point, accounting
   * for the advance between them. `buffer` is the morx-deletion-marker-preserved
   * glyph run the state machine matched against; markers map to no output glyph.
   */
  private applyKerxAttachments(
    result: ShapedGlyph[],
    buffer: number[],
    direction: 'horizontal' | 'vertical',
    boundary: 'text' | 'line' = 'text',
  ): void {
    const attachments = this.tableManager.kerx!.getAttachments(buffer, direction, boundary)
    if (attachments.length === 0) return
    const ankr = this.tableManager.ankr
    // Map marker-preserved buffer positions to output (marker-free) positions.
    const toResult = new Array<number>(buffer.length).fill(-1)
    let ri = 0
    for (let bi = 0; bi < buffer.length; bi++) {
      if (buffer[bi] !== 0xFFFF) toResult[bi] = ri++
    }
    // Pen position at each output glyph in the selected writing direction.
    const penX = new Array<number>(result.length).fill(0)
    const penY = new Array<number>(result.length).fill(0)
    let accX = 0
    let accY = 0
    for (let k = 0; k < result.length; k++) {
      penX[k] = accX
      penY[k] = accY
      accX += result[k]!.xAdvance
      accY += result[k]!.yAdvance
    }
    for (let a = 0; a < attachments.length; a++) {
      const att = attachments[a]!
      const mr = toResult[att.markIndex]!
      const cr = toResult[att.currentIndex]!
      if (mr < 0 || cr < 0) continue
      let markX: number, markY: number, currX: number, currY: number
      if (att.actionType === 0) {
        const markPoint = this.getGlyphControlPoint(result[mr]!.glyphId, att.values[0]!)
        const currPoint = this.getGlyphControlPoint(result[cr]!.glyphId, att.values[1]!)
        markX = markPoint.x; markY = markPoint.y; currX = currPoint.x; currY = currPoint.y
      } else if (att.actionType === 1) {
        if (ankr !== null) {
          const markAnchors = ankr.getAnchorPoints(result[mr]!.glyphId)
          const currAnchors = ankr.getAnchorPoints(result[cr]!.glyphId)
          if (markAnchors === null || currAnchors === null) continue
          const ma = markAnchors[att.values[0]!]
          const ca = currAnchors[att.values[1]!]
          if (ma === undefined || ca === undefined) continue
          markX = ma.x; markY = ma.y; currX = ca.x; currY = ca.y
        } else {
          const markPoint = this.getGlyphControlPoint(result[mr]!.glyphId, att.values[0]!)
          const currPoint = this.getGlyphControlPoint(result[cr]!.glyphId, att.values[1]!)
          markX = markPoint.x; markY = markPoint.y; currX = currPoint.x; currY = currPoint.y
        }
      } else if (att.actionType === 2) {
        markX = att.values[0]!; markY = att.values[1]!; currX = att.values[2]!; currY = att.values[3]!
      } else {
        throw new Error(`Unsupported kerx format 4 action type: ${att.actionType}`)
      }
      result[cr]!.xOffset += (penX[mr]! + markX) - (penX[cr]! + currX)
      result[cr]!.yOffset += (penY[mr]! + markY) - (penY[cr]! + currY)
    }
  }

  /**
   * Centers unpositioned nonspacing combining marks over their cluster base,
   * matching HarfBuzz's fallback mark positioning for fonts without GPOS/AAT
   * mark attachment. `clusters[j]` is the source (baseCps) index of output
   * glyph j; a mark's base is the glyph whose cluster is the mark's grapheme
   * base (the preceding non-mark character).
   */
  private applyFallbackMarkPositioning(
    result: ShapedGlyph[],
    clusters: number[],
    baseCps: number[],
  ): void {
    // Grapheme base for each source character: a nonspacing combining mark
    // belongs to the nearest preceding non-mark character.
    const graphemeBase = new Array<number>(baseCps.length)
    for (let k = 0; k < baseCps.length; k++) {
      graphemeBase[k] = getCombiningClass(baseCps[k]!) !== 0 && k > 0 ? graphemeBase[k - 1]! : k
    }
    for (let j = 0; j < result.length; j++) {
      const g = result[j]!
      // Only position marks nothing else touched.
      if (g.xOffset !== 0 || g.yOffset !== 0) continue
      const srcChar = clusters[j]
      if (srcChar === undefined) continue
      const cp = baseCps[srcChar]
      if (cp === undefined || getCombiningClass(cp) === 0) continue
      // Only nonspacing marks (zero advance) stack over the base. A spacing mark
      // (its own advance, e.g. a Tibetan vowel sign drawn in its own box) sits
      // after the base by its advance; HarfBuzz's fallback repositions only the
      // zeroed (nonspacing) marks, so centering a spacing one would misplace it.
      if (g.xAdvance !== 0) continue
      // Thai and Lao (U+0E00–U+0EFF) marks are pre-positioned by the glyph
      // outline itself (a negative left side bearing places the mark over the
      // preceding advanced base). HarfBuzz shapes these through the dedicated
      // Thai shaper, which does no generic mark centering — matching that here
      // leaves the mark at its designed position instead of re-centering it.
      const markScript = getUnicodeScript(cp)
      if (markScript === 'Thai' || markScript === 'Lao') continue
      const baseChar = graphemeBase[srcChar]!
      if (baseChar === srcChar) continue
      // Find the base glyph (the output glyph carrying the base character).
      let baseIdx = -1
      for (let b = 0; b < result.length; b++) {
        if (clusters[b] === baseChar) { baseIdx = b; break }
      }
      if (baseIdx < 0) continue
      const baseAdvance = this.getAdvanceWidth(result[baseIdx]!.glyphId)
      const mark = this.getGlyph(g.glyphId)
      const markWidth = mark.xMax - mark.xMin
      // Center align: x = (baseWidth - markWidth)/2 - markXBearing, with the
      // base extent taken as [0, advance] (HarfBuzz uses the advance as width).
      g.xOffset = Math.floor((baseAdvance - markWidth) / 2) - mark.xMin
    }
  }

  /**
   * Clears the glyph cache
   */
  clearGlyphCache(): void {
    this.glyphCache.clear()
    this.trueTypeVariationMetricsCache.clear()
    this.defaultTrueTypeYMaxCache.clear()
  }

  private buildMetrics(): FontMetrics {
    const head = this.tableManager.head
    const os2 = this.tableManager.os2
    const post = this.tableManager.post
    // A bitmap-only font (e.g. macOS NISC18030) has no hhea; its line metrics
    // come from OS/2 instead. hhea is only read when OS/2 typo* metrics are
    // absent, so it is accessed lazily.
    const hhea = this.tableManager.hasHorizontalMetrics ? this.tableManager.hhea : null
    const vhea = this.tableManager.vhea

    // Prefer OS/2 typo* metrics. However, 0 is an intentional value, so check explicitly instead of using ||
    const useTypo = (os2.fsSelection & 0x0080) !== 0
    let ascender = useTypo ? os2.typoAscender : (hhea?.ascender ?? os2.winAscent ?? head.unitsPerEm)
    let descender = useTypo ? os2.typoDescender : (hhea?.descender ?? -(os2.winDescent ?? 0))
    let lineGap = useTypo ? os2.typoLineGap : (hhea?.lineGap ?? 0)
    let horizontalClippingAscent = os2.winAscent
    let horizontalClippingDescent = os2.winDescent
    let verticalAscender = vhea?.ascender ?? 0
    let verticalDescender = vhea?.descender ?? 0
    let verticalLineGap = vhea?.lineGap ?? 0
    let horizontalCaretSlopeRise = hhea?.caretSlopeRise ?? 0
    let horizontalCaretSlopeRun = hhea?.caretSlopeRun ?? 0
    let horizontalCaretOffset = hhea?.caretOffset ?? 0
    let verticalCaretSlopeRise = vhea?.caretSlopeRise ?? 0
    let verticalCaretSlopeRun = vhea?.caretSlopeRun ?? 0
    let verticalCaretOffset = vhea?.caretOffset ?? 0
    let capHeight = os2.capHeight || 0
    let xHeight = os2.xHeight || 0
    let underlinePosition = post.underlinePosition
    let underlineThickness = post.underlineThickness
    // OS/2 strikeout metrics; a zero position falls back to the spec-common
    // mid-x-height placement so text without OS/2 values still strikes through
    let strikeoutPosition = os2.strikeoutPosition !== 0 ? os2.strikeoutPosition : Math.round((os2.xHeight || head.unitsPerEm * 0.5) / 2)
    let strikeoutSize = os2.strikeoutSize !== 0 ? os2.strikeoutSize : post.underlineThickness
    // OS/2 sub/superscript metrics; zero values take the common conventions
    const upem = head.unitsPerEm
    let subscriptXSize = os2.subscriptXSize !== 0 ? os2.subscriptXSize : Math.round(upem * 0.65)
    let subscriptYSize = os2.subscriptYSize !== 0 ? os2.subscriptYSize : Math.round(upem * 0.6)
    let subscriptYOffset = os2.subscriptYOffset !== 0 ? os2.subscriptYOffset : Math.round(upem * 0.075)
    let subscriptXOffset = os2.subscriptXOffset
    let superscriptXSize = os2.superscriptXSize !== 0 ? os2.superscriptXSize : Math.round(upem * 0.65)
    let superscriptYSize = os2.superscriptYSize !== 0 ? os2.superscriptYSize : Math.round(upem * 0.6)
    let superscriptYOffset = os2.superscriptYOffset !== 0 ? os2.superscriptYOffset : Math.round(upem * 0.35)
    let superscriptXOffset = os2.superscriptXOffset

    // AAT fmtx point metrics replace hhea/vhea ascent, descent, and caret
    // geometry. The point coordinates already include gvar deltas for the
    // current variation instance.
    const pointMetrics = this.getAatPointMetrics()
    if (pointMetrics !== null) {
      ascender = pointMetrics.horizontalBefore.y
      descender = pointMetrics.horizontalAfter.y
      lineGap = 0
      horizontalCaretSlopeRise = pointMetrics.horizontalCaretHead.y - pointMetrics.horizontalCaretBase.y
      horizontalCaretSlopeRun = pointMetrics.horizontalCaretHead.x - pointMetrics.horizontalCaretBase.x
      horizontalCaretOffset = pointMetrics.horizontalCaretBase.x
      verticalAscender = pointMetrics.verticalBefore.x
      verticalDescender = pointMetrics.verticalAfter.x
      verticalLineGap = 0
      verticalCaretSlopeRise = pointMetrics.verticalCaretHead.y - pointMetrics.verticalCaretBase.y
      verticalCaretSlopeRun = pointMetrics.verticalCaretHead.x - pointMetrics.verticalCaretBase.x
      verticalCaretOffset = pointMetrics.verticalCaretBase.y
    }

    // MVAR deltas
    const coords = this.tableManager.normalizedCoords
    if (coords) {
      const mvar = this.tableManager.mvar
      if (mvar) {
        ascender += mvar.getMetricDelta('hasc', coords)
        descender += mvar.getMetricDelta('hdsc', coords)
        lineGap += mvar.getMetricDelta('hlgp', coords)
        horizontalClippingAscent += mvar.getMetricDelta('hcla', coords)
        horizontalClippingDescent += mvar.getMetricDelta('hcld', coords)
        verticalAscender += mvar.getMetricDelta('vasc', coords)
        verticalDescender += mvar.getMetricDelta('vdsc', coords)
        verticalLineGap += mvar.getMetricDelta('vlgp', coords)
        horizontalCaretSlopeRise += mvar.getMetricDelta('hcrs', coords)
        horizontalCaretSlopeRun += mvar.getMetricDelta('hcrn', coords)
        horizontalCaretOffset += mvar.getMetricDelta('hcof', coords)
        verticalCaretSlopeRise += mvar.getMetricDelta('vcrs', coords)
        verticalCaretSlopeRun += mvar.getMetricDelta('vcrn', coords)
        verticalCaretOffset += mvar.getMetricDelta('vcof', coords)
        capHeight += mvar.getMetricDelta('cpht', coords)
        xHeight += mvar.getMetricDelta('xhgt', coords)
        underlinePosition += mvar.getMetricDelta('undo', coords)
        underlineThickness += mvar.getMetricDelta('unds', coords)
        strikeoutPosition += mvar.getMetricDelta('stro', coords)
        strikeoutSize += mvar.getMetricDelta('strs', coords)
        subscriptXSize += mvar.getMetricDelta('sbxs', coords)
        subscriptYSize += mvar.getMetricDelta('sbys', coords)
        subscriptXOffset += mvar.getMetricDelta('sbxo', coords)
        subscriptYOffset += mvar.getMetricDelta('sbyo', coords)
        superscriptXSize += mvar.getMetricDelta('spxs', coords)
        superscriptYSize += mvar.getMetricDelta('spys', coords)
        superscriptXOffset += mvar.getMetricDelta('spxo', coords)
        superscriptYOffset += mvar.getMetricDelta('spyo', coords)
      }
    }

    return {
      unitsPerEm: head.unitsPerEm,
      ascender,
      descender,
      lineGap,
      horizontalClippingAscent,
      horizontalClippingDescent,
      verticalAscender,
      verticalDescender,
      verticalLineGap,
      horizontalCaretSlopeRise,
      horizontalCaretSlopeRun,
      horizontalCaretOffset,
      verticalCaretSlopeRise,
      verticalCaretSlopeRun,
      verticalCaretOffset,
      capHeight,
      xHeight,
      italicAngle: post.italicAngle,
      underlinePosition,
      underlineThickness,
      strikeoutPosition,
      strikeoutSize,
      subscriptXSize,
      subscriptYSize,
      subscriptYOffset,
      subscriptXOffset,
      superscriptXSize,
      superscriptYSize,
      superscriptYOffset,
      superscriptXOffset,
      weightClass: this.currentUserCoords?.['wght'] ?? os2.weightClass,
      widthClass: this.currentUserCoords?.['wdth'] === undefined ? os2.widthClass : widthClassFromPercentage(this.currentUserCoords['wdth']!),
      useTypographicMetrics: useTypo,
      isBold: this.variationIsBold((os2.fsSelection & 0x0020) !== 0),
      isItalic: this.variationIsItalic((os2.fsSelection & 0x0001) !== 0),
      isOblique: this.currentUserCoords?.['slnt'] !== undefined
        ? this.currentUserCoords['slnt']! !== 0
        : (os2.fsSelection & 0x0200) !== 0,
      isMonospace: post.isFixedPitch !== 0,
    }
  }
}

function getExactOutlineBounds(outline: Glyph['outline']): { xMin: number, yMin: number, xMax: number, yMax: number } {
  if (outline.coords.length < 2) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  let currentX = 0, currentY = 0, coordinateIndex = 0
  for (let commandIndex = 0; commandIndex < outline.commands.length; commandIndex++) {
    const command = outline.commands[commandIndex]!
    if (command === 0 || command === 1) {
      currentX = outline.coords[coordinateIndex++]!
      currentY = outline.coords[coordinateIndex++]!
      if (currentX < xMin) xMin = currentX
      if (currentX > xMax) xMax = currentX
      if (currentY < yMin) yMin = currentY
      if (currentY > yMax) yMax = currentY
    } else if (command === 2) {
      const control1X = outline.coords[coordinateIndex++]!
      const control1Y = outline.coords[coordinateIndex++]!
      const control2X = outline.coords[coordinateIndex++]!
      const control2Y = outline.coords[coordinateIndex++]!
      const endX = outline.coords[coordinateIndex++]!
      const endY = outline.coords[coordinateIndex++]!
      const xRoots = cubicDerivativeRoots(currentX, control1X, control2X, endX)
      const yRoots = cubicDerivativeRoots(currentY, control1Y, control2Y, endY)
      for (let i = -1; i < xRoots.length + yRoots.length; i++) {
        const t = i < 0 ? 1 : i < xRoots.length ? xRoots[i]! : yRoots[i - xRoots.length]!
        const x = cubicValue(currentX, control1X, control2X, endX, t)
        const y = cubicValue(currentY, control1Y, control2Y, endY, t)
        if (x < xMin) xMin = x
        if (x > xMax) xMax = x
        if (y < yMin) yMin = y
        if (y > yMax) yMax = y
      }
      currentX = endX
      currentY = endY
    }
  }
  return { xMin, yMin, xMax, yMax }
}

function cubicDerivativeRoots(start: number, control1: number, control2: number, end: number): number[] {
  const a = -start + 3 * control1 - 3 * control2 + end
  const b = 2 * (start - 2 * control1 + control2)
  const c = control1 - start
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return []
    const root = -c / b
    return root > 0 && root < 1 ? [root] : []
  }
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return []
  const squareRoot = Math.sqrt(discriminant)
  const first = (-b - squareRoot) / (2 * a)
  const second = (-b + squareRoot) / (2 * a)
  const roots: number[] = []
  if (first > 0 && first < 1) roots.push(first)
  if (second > 0 && second < 1 && Math.abs(second - first) > 1e-12) roots.push(second)
  return roots
}

function cubicValue(start: number, control1: number, control2: number, end: number, t: number): number {
  const inverse = 1 - t
  return inverse * inverse * inverse * start
    + 3 * inverse * inverse * t * control1
    + 3 * inverse * t * t * control2
    + t * t * t * end
}

function widthClassFromPercentage(percentage: number): number {
  const values = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200]
  let best = 0
  let distance = Math.abs(percentage - values[0]!)
  for (let i = 1; i < values.length; i++) {
    const candidate = Math.abs(percentage - values[i]!)
    if (candidate < distance) { best = i; distance = candidate }
  }
  return best + 1
}

function validatePaletteColor(color: ColorPaletteColor): void {
  const components = [color.r, color.g, color.b, color.a]
  for (let i = 0; i < components.length; i++) {
    if (!Number.isInteger(components[i]) || components[i]! < 0 || components[i]! > 255) {
      throw new Error('CPAL palette override components must be integers from 0 to 255')
    }
  }
}

function closestSbixStrike(
  strikes: readonly { ppem: number; ppi: number }[],
  targetPpem: number,
  targetPpi?: number,
): { ppem: number; ppi: number } {
  let best = strikes[0]!
  let bestPpemDistance = Math.abs(best.ppem - targetPpem)
  let bestPpiDistance = targetPpi === undefined ? 0 : Math.abs(best.ppi - targetPpi)
  for (let i = 1; i < strikes.length; i++) {
    const candidate = strikes[i]!
    const ppemDistance = Math.abs(candidate.ppem - targetPpem)
    const ppiDistance = targetPpi === undefined ? 0 : Math.abs(candidate.ppi - targetPpi)
    if (ppemDistance < bestPpemDistance || (ppemDistance === bestPpemDistance && ppiDistance < bestPpiDistance)) {
      best = candidate
      bestPpemDistance = ppemDistance
      bestPpiDistance = ppiDistance
    }
  }
  return best
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left
  let b = right
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

export function validateSfntChecksums(sfnt: SfntData): void {
  if (sfnt.collection !== undefined) {
    for (let i = 0; i < sfnt.collection.fontOffsets.length; i++) {
      validateSingleSfntDirectory(parseSfntDirectory(sfnt.buffer, sfnt.collection.fontOffsets[i]!), true)
    }
    return
  }
  validateSingleSfntDirectory(sfnt, false)
}

function validateSingleSfntDirectory(sfnt: SfntData, collection: boolean): void {
  const view = new DataView(sfnt.buffer)
  const offset = sfnt.offsetInBuffer
  if (sfnt.sfntVersion !== 0x00010000 && sfnt.sfntVersion !== 0x4F54544F) {
    throw new Error('OpenType 1.9.1 sfntVersion must be 0x00010000 or OTTO')
  }
  const numTables = view.getUint16(offset + 4)
  let maxPowerOfTwo = 1
  let entrySelector = 0
  while (maxPowerOfTwo * 2 <= numTables) {
    maxPowerOfTwo *= 2
    entrySelector++
  }
  const expectedSearchRange = maxPowerOfTwo * 16
  const expectedRangeShift = numTables * 16 - expectedSearchRange
  if (view.getUint16(offset + 6) !== expectedSearchRange ||
      view.getUint16(offset + 8) !== entrySelector ||
      view.getUint16(offset + 10) !== expectedRangeShift) {
    throw new Error('OpenType sfnt directory search fields do not match numTables')
  }

  const ranges: Array<{ start: number, end: number, tag: string }> = []
  for (const entry of sfnt.tableDirectory.values()) {
    if ((entry.offset & 3) !== 0) {
      throw new Error(`OpenType table '${entry.tag}' offset must be four-byte aligned`)
    }
    const checksum = computeSfntChecksum(sfnt.buffer, entry.offset, entry.length, entry.tag === 'head')
    if (checksum !== entry.checksum) {
      throw new Error(`OpenType table '${entry.tag}' checksum mismatch`)
    }
    const paddedEnd = entry.offset + ((entry.length + 3) & ~3)
    if (paddedEnd > sfnt.buffer.byteLength) throw new Error(`OpenType table '${entry.tag}' padding exceeds font data`)
    const bytes = new Uint8Array(sfnt.buffer)
    for (let position = entry.offset + entry.length; position < paddedEnd; position++) {
      if (bytes[position] !== 0) throw new Error(`OpenType table '${entry.tag}' padding must contain only zero bytes`)
    }
    ranges.push({ start: entry.offset, end: entry.offset + entry.length, tag: entry.tag })
  }
  ranges.sort(compareSfntRanges)
  for (let i = 1; i < ranges.length; i++) {
    const previous = ranges[i - 1]!
    const current = ranges[i]!
    if (current.start < previous.end && (current.start !== previous.start || current.end !== previous.end)) {
      throw new Error(`OpenType tables '${previous.tag}' and '${current.tag}' overlap`)
    }
  }

  if (!collection && offset === 0) {
    const checksum = computeSfntChecksum(sfnt.buffer, 0, sfnt.buffer.byteLength, false)
    if (checksum !== 0xB1B0AFBA) {
      throw new Error('OpenType head.checksumAdjustment does not balance the standalone font checksum')
    }
  }
}

function compareSfntRanges(a: { start: number, end: number }, b: { start: number, end: number }): number {
  return a.start - b.start || a.end - b.end
}

function computeSfntChecksum(buffer: ArrayBuffer, offset: number, length: number, zeroHeadAdjustment: boolean): number {
  const bytes = new Uint8Array(buffer, offset, length)
  let sum = 0
  for (let i = 0; i < length; i += 4) {
    let word = 0
    for (let j = 0; j < 4; j++) {
      const index = i + j
      let value = index < length ? bytes[index]! : 0
      if (zeroHeadAdjustment && index >= 8 && index < 12) value = 0
      word = (word << 8) | value
    }
    sum = (sum + (word >>> 0)) >>> 0
  }
  return sum
}

/** Selects the strike whose ppemY is closest to the target (same rule as CBDT/EBDT tables) */
function closestStrike(strikes: readonly BitmapSizeRecord[], targetX: number, targetY: number): BitmapSizeRecord {
  let best = strikes[0]!
  let bestDiff = Math.abs(best.ppemX - targetX) + Math.abs(best.ppemY - targetY)
  for (let i = 1; i < strikes.length; i++) {
    const diff = Math.abs(strikes[i]!.ppemX - targetX) + Math.abs(strikes[i]!.ppemY - targetY)
    if (diff < bestDiff) {
      best = strikes[i]!
      bestDiff = diff
    }
  }
  return best
}

function collectTextSubsetGlyphs(
  font: Font,
  text: string,
  glyphIds: Set<number>,
  codePointToGlyphId: Map<number, number>,
): void {
  const codePoints: number[] = []
  for (const character of text) codePoints.push(character.codePointAt(0)!)
  for (let i = 0; i < codePoints.length; i++) {
    const codePoint = codePoints[i]!
    const baseGlyphId = font.getGlyphId(codePoint)
    const next = i + 1 < codePoints.length ? codePoints[i + 1]! : -1
    if (isVariationSelector(next)) {
      const variationGlyphId = font.cmap.getVariationGlyphId(codePoint, next)
      if (variationGlyphId !== null && variationGlyphId !== 0) glyphIds.add(variationGlyphId)
      if (variationGlyphId !== null) codePointToGlyphId.set(codePoint, baseGlyphId)
      i++
    }
    if (baseGlyphId !== 0) {
      glyphIds.add(baseGlyphId)
      codePointToGlyphId.set(codePoint, baseGlyphId)
    }
  }
}

/**
 * Unicode variation selectors: VS1-VS16 (U+FE00-FE0F), VS17-VS256
 * (U+E0100-E01EF) and the Mongolian free variation selectors
 * (U+180B-180D, U+180F).
 */
function isVariationSelector(cp: number): boolean {
  return (cp >= 0xFE00 && cp <= 0xFE0F) ||
         (cp >= 0xE0100 && cp <= 0xE01EF) ||
         (cp >= 0x180B && cp <= 0x180D) || cp === 0x180F
}

/**
 * Derives per-output-glyph source-component counts from AAT morx cluster
 * tracking: `clusters[i]` is the source-glyph index the output glyph came from,
 * so the span to the next glyph's source index is how many source glyphs it
 * covers (a ligature covers >1). Returns all-ones when the clusters are not
 * strictly increasing (RTL / reordering), where a per-glyph span is undefined.
 */
/**
 * Per-output-glyph source-component counts from the cluster (source start
 * index) of each glyph. Order-independent: a glyph's count is the span from its
 * cluster to the next distinct cluster value, so it stays correct when a shaper
 * reorders glyphs out of source order (e.g. Indic reph, pre-base matras). When
 * several glyphs share a cluster (a merged run), the first carries the whole
 * span and the rest carry 0, keeping the total equal to the source length.
 */
function deriveComponentCountsFromClusters(clusters: number[], totalSources: number): number[] {
  const n = clusters.length
  if (n === 0) return []
  const distinct = [...new Set(clusters)].sort((a, b) => a - b)
  const spanByCluster = new Map<number, number>()
  for (let i = 0; i < distinct.length; i++) {
    const next = i + 1 < distinct.length ? distinct[i + 1]! : totalSources
    spanByCluster.set(distinct[i]!, Math.max(1, next - distinct[i]!))
  }
  const counts = new Array<number>(n)
  const assigned = new Set<number>()
  for (let i = 0; i < n; i++) {
    const c = clusters[i]!
    if (assigned.has(c)) { counts[i] = 0 } else { counts[i] = spanByCluster.get(c)!; assigned.add(c) }
  }
  return counts
}

/** Hide shaped glyphs whose carried Unicode source property is default-ignorable. */
function hideDefaultIgnorableGlyphs(
  font: Font,
  glyphs: ShapedGlyph[],
  flags: readonly number[],
): void {
  let hasIgnorable = false
  for (let i = 0; i < flags.length; i++) {
    if (isHiddenDefaultIgnorable(flags[i]!)) { hasIgnorable = true; break }
  }
  if (!hasIgnorable) return

  const space = font.getGlyphId(0x20)
  if (space !== 0) {
    for (let i = 0; i < glyphs.length; i++) {
      if (!isHiddenDefaultIgnorable(flags[i]!)) continue
      const glyph = glyphs[i]!
      glyph.glyphId = space
      glyph.xOffset = 0
      glyph.yOffset = 0
      glyph.xAdvance = 0
      glyph.yAdvance = 0
    }
  } else {
    for (let i = glyphs.length - 1; i >= 0; i--) {
      if (isHiddenDefaultIgnorable(flags[i]!)) glyphs.splice(i, 1)
    }
  }
}

function isHiddenDefaultIgnorable(flags: number): boolean {
  return (flags & GLYPH_FLAG_DEFAULT_IGNORABLE) !== 0 && (flags & GLYPH_FLAG_SUBSTITUTED) === 0
}
