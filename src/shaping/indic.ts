/**
 * Indic shaper (Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil,
 * Telugu, Kannada, Malayalam, Sinhala).
 *
 * Pipeline (mirroring the OpenType Indic shaping model):
 *  1. Script-specific normalization (split matra / nukta decomposition,
 *     canonical mark reorder, recomposition).
 *  2. Character classification and syllable segmentation.
 *  3. GSUB stage: locl + ccmp (per syllable).
 *  4. Initial reordering: base-consonant detection (using would-substitute
 *     tests against the font's blwf/pstf/pref/vatu lookups), reph detection
 *     (rphf), position assignment, pre-base matra reorder, per-glyph feature
 *     masks.
 *  5. GSUB basic features, one stage each: nukt, akhn, rphf, rkrf, pref,
 *     blwf, abvf, half, pstf, vatu, cjct.
 *  6. Final reordering: matra repositioning, reph repositioning, pre-base
 *     reordering Ra, init mask.
 *  7. GSUB presentation features: init, pres, abvs, blws, psts, haln plus
 *     the common discretionary features.
 */

import type { GsubShapingFeature } from '../parsers/tables/gsub.js'
import {
  GSUB_MASK_GLOBAL, GLYPH_FLAG_SUBSTITUTED, GLYPH_FLAG_LIGATED, GLYPH_FLAG_MULTIPLIED,
} from '../parsers/tables/gsub.js'
import {
  CAT_C, CAT_V, CAT_N, CAT_H, CAT_ZWNJ, CAT_ZWJ, CAT_M, CAT_SM, CAT_A,
  CAT_PLACEHOLDER, CAT_DOTTEDCIRCLE, CAT_RS, CAT_MPst, CAT_Repha, CAT_Ra,
  CAT_CM, CAT_Symbol, CAT_CS, CAT_SMPst,
  POS_START, POS_RA_TO_BECOME_REPH, POS_PRE_M, POS_PRE_C, POS_BASE_C,
  POS_AFTER_MAIN, POS_BEFORE_SUB, POS_BELOW_C, POS_AFTER_SUB, POS_BEFORE_POST,
  POS_POST_C, POS_AFTER_POST, POS_SMVD, POS_END,
  getShapingClass,
} from './ot-categories.js'
import {
  type ComplexBuffer, type ShapeContext,
  auxCategory, auxPosition, auxWithPosition, auxWithCategory, AUX_INIT_BLOCKED,
  buildComplexBuffer, findSyllables, mergeClusters, moveGlyphBack, moveGlyphForward,
  reverseRange, sortByPosition, insertGlyph, appendUserShapingFeatures,
} from './complex.js'
import { SyllableGrammar, type SyllableScanner } from './syllable-machine.js'
import { getIndicDecomposition, composeIndicPair, reorderMarkRuns } from './normalize.js'
import { getUnicodeScript } from './unicode-shaping-properties.js'

// --- Feature masks (bit 0 is the global mask) ---

const MASK_RPHF = 1 << 1
const MASK_PREF = 1 << 2
const MASK_BLWF = 1 << 3
const MASK_ABVF = 1 << 4
const MASK_HALF = 1 << 5
const MASK_PSTF = 1 << 6
const MASK_INIT = 1 << 7

// --- Script configurations ---

const REPH_MODE_IMPLICIT = 0
const REPH_MODE_EXPLICIT = 1
const REPH_MODE_LOG_REPHA = 2

const BLWF_MODE_PRE_AND_POST = 0
const BLWF_MODE_POST_ONLY = 1

interface IndicConfig {
  blockBase: number
  virama: number
  rephPos: number
  rephMode: number
  blwfMode: number
  hasOldSpec: boolean
  newTag: string
}

const INDIC_CONFIGS: readonly IndicConfig[] = [
  { blockBase: 0x0900, virama: 0x094D, rephPos: POS_BEFORE_POST, rephMode: REPH_MODE_IMPLICIT, blwfMode: BLWF_MODE_PRE_AND_POST, hasOldSpec: true, newTag: 'dev2' },
  { blockBase: 0x0980, virama: 0x09CD, rephPos: POS_AFTER_SUB, rephMode: REPH_MODE_IMPLICIT, blwfMode: BLWF_MODE_PRE_AND_POST, hasOldSpec: true, newTag: 'bng2' },
  { blockBase: 0x0A00, virama: 0x0A4D, rephPos: POS_BEFORE_SUB, rephMode: REPH_MODE_IMPLICIT, blwfMode: BLWF_MODE_PRE_AND_POST, hasOldSpec: true, newTag: 'gur2' },
  { blockBase: 0x0A80, virama: 0x0ACD, rephPos: POS_BEFORE_POST, rephMode: REPH_MODE_IMPLICIT, blwfMode: BLWF_MODE_PRE_AND_POST, hasOldSpec: true, newTag: 'gjr2' },
  { blockBase: 0x0B00, virama: 0x0B4D, rephPos: POS_AFTER_MAIN, rephMode: REPH_MODE_IMPLICIT, blwfMode: BLWF_MODE_PRE_AND_POST, hasOldSpec: true, newTag: 'ory2' },
  { blockBase: 0x0B80, virama: 0x0BCD, rephPos: POS_AFTER_POST, rephMode: REPH_MODE_IMPLICIT, blwfMode: BLWF_MODE_PRE_AND_POST, hasOldSpec: true, newTag: 'tml2' },
  { blockBase: 0x0C00, virama: 0x0C4D, rephPos: POS_AFTER_POST, rephMode: REPH_MODE_EXPLICIT, blwfMode: BLWF_MODE_POST_ONLY, hasOldSpec: true, newTag: 'tel2' },
  { blockBase: 0x0C80, virama: 0x0CCD, rephPos: POS_AFTER_POST, rephMode: REPH_MODE_IMPLICIT, blwfMode: BLWF_MODE_POST_ONLY, hasOldSpec: true, newTag: 'knd2' },
  { blockBase: 0x0D00, virama: 0x0D4D, rephPos: POS_AFTER_MAIN, rephMode: REPH_MODE_LOG_REPHA, blwfMode: BLWF_MODE_PRE_AND_POST, hasOldSpec: true, newTag: 'mlm2' },
  { blockBase: 0x0D80, virama: 0x0DCA, rephPos: POS_AFTER_MAIN, rephMode: REPH_MODE_IMPLICIT, blwfMode: BLWF_MODE_PRE_AND_POST, hasOldSpec: false, newTag: 'sinh' },
]

/** Whether the code point belongs to an Indic script handled by this shaper. */
export function isIndicChar(cp: number): boolean {
  switch (getUnicodeScript(cp)) {
    case 'Devanagari':
    case 'Bengali':
    case 'Gurmukhi':
    case 'Gujarati':
    case 'Oriya':
    case 'Tamil':
    case 'Telugu':
    case 'Kannada':
    case 'Malayalam':
    case 'Sinhala': return true
    default: return false
  }
}

// --- Syllable machine (Indic grammar) ---

const SYL_CONSONANT = 1
const SYL_VOWEL = 2
const SYL_STANDALONE = 3
const SYL_SYMBOL = 4
const SYL_BROKEN = 5
const SYL_NON_INDIC = 6

function buildIndicScanner(): SyllableScanner {
  const g = new SyllableGrammar()

  const c = () => g.cat([CAT_C, CAT_Ra])
  const n = () => g.seq(
    g.opt(g.seq(g.opt(g.cat([CAT_ZWNJ])), g.cat([CAT_RS]))),
    g.opt(g.seq(g.cat([CAT_N]), g.opt(g.cat([CAT_N])))),
  )
  const z = () => g.cat([CAT_ZWJ, CAT_ZWNJ])
  const reph = () => g.alt(g.seq(g.cat([CAT_Ra]), g.cat([CAT_H])), g.cat([CAT_Repha]))
  const sm = () => g.cat([CAT_SM, CAT_SMPst])
  const cn = () => g.seq(c(), g.opt(g.cat([CAT_ZWJ])), g.opt(n()))
  const symbol = () => g.seq(g.cat([CAT_Symbol]), g.opt(g.cat([CAT_N])))
  const matraGroup = () => g.seq(
    g.star(z()),
    g.alt(g.cat([CAT_M]), g.seq(g.opt(sm()), g.cat([CAT_MPst]))),
    g.opt(g.cat([CAT_N])),
    g.opt(g.cat([CAT_H])),
  )
  const syllableTail = () => g.seq(
    g.opt(g.seq(g.opt(z()), sm(), g.opt(sm()), g.opt(g.cat([CAT_ZWNJ])))),
    g.star(g.cat([CAT_A])),
  )
  const halantGroup = () => g.seq(
    g.opt(z()), g.cat([CAT_H]),
    g.opt(g.seq(g.cat([CAT_ZWJ]), g.opt(g.cat([CAT_N])))),
  )
  const finalHalantGroup = () => g.alt(halantGroup(), g.seq(g.cat([CAT_H]), g.cat([CAT_ZWNJ])))
  const medialGroup = () => g.opt(g.cat([CAT_CM]))
  const halantOrMatraGroup = () => g.alt(finalHalantGroup(), g.star(matraGroup()))
  const complexSyllableTail = () => g.seq(
    g.star(g.seq(halantGroup(), cn())),
    medialGroup(),
    halantOrMatraGroup(),
    syllableTail(),
  )

  const consonantSyllable = g.seq(
    g.opt(g.cat([CAT_Repha, CAT_CS])),
    cn(),
    complexSyllableTail(),
  )
  const vowelSyllable = g.seq(
    g.opt(reph()),
    g.cat([CAT_V]),
    g.opt(n()),
    g.alt(g.cat([CAT_ZWJ]), complexSyllableTail()),
  )
  const standaloneCluster = g.seq(
    g.alt(
      g.seq(g.opt(g.cat([CAT_Repha, CAT_CS])), g.cat([CAT_PLACEHOLDER])),
      g.seq(g.opt(reph()), g.cat([CAT_DOTTEDCIRCLE])),
    ),
    g.opt(n()),
    complexSyllableTail(),
  )
  const symbolCluster = g.seq(symbol(), syllableTail())
  const brokenCluster = g.seq(g.opt(reph()), g.opt(n()), complexSyllableTail())

  g.token(consonantSyllable, SYL_CONSONANT)
  g.token(vowelSyllable, SYL_VOWEL)
  g.token(standaloneCluster, SYL_STANDALONE)
  g.token(symbolCluster, SYL_SYMBOL)
  g.token(g.cat([CAT_SMPst]), SYL_NON_INDIC)
  g.token(brokenCluster, SYL_BROKEN)

  return g.build()
}

const INDIC_SCANNER = buildIndicScanner()

// --- Category flag helpers ---

const CONSONANT_FLAGS_INDIC =
  (1 << CAT_C) | (1 << CAT_CS) | (1 << CAT_Ra) | (1 << CAT_CM) | (1 << CAT_V) |
  (1 << CAT_PLACEHOLDER) | (1 << CAT_DOTTEDCIRCLE)
const JOINER_FLAGS = (1 << CAT_ZWNJ) | (1 << CAT_ZWJ)

/** Whether buffer glyph i currently belongs to the category set (ligated glyphs never match). */
function isOneOf(buf: ComplexBuffer, i: number, catFlags: number): boolean {
  if ((buf.flags[i]! & GLYPH_FLAG_LIGATED) !== 0) return false
  return ((1 << auxCategory(buf.aux[i]!)) & catFlags) !== 0
}

function isConsonant(buf: ComplexBuffer, i: number): boolean {
  return isOneOf(buf, i, CONSONANT_FLAGS_INDIC)
}

function isJoiner(buf: ComplexBuffer, i: number): boolean {
  return isOneOf(buf, i, JOINER_FLAGS)
}

function isHalant(buf: ComplexBuffer, i: number): boolean {
  return isOneOf(buf, i, 1 << CAT_H)
}

// --- Shaping plan ---

interface IndicPlan {
  config: IndicConfig
  scriptTag: string
  isOldSpec: boolean
  zeroContext: boolean
  viramaGlyph: number
  rphf: number[]
  pref: number[]
  blwf: number[]
  pstf: number[]
  vatu: number[]
  consonantPos: Map<number, number>
}

/**
 * Plans (including the would-substitute consonant-position cache) persist
 * per GSUB table so repeated runs of the same script reuse them.
 */
const PLAN_CACHE = new WeakMap<object, Map<string, IndicPlan>>()

function createIndicPlan(ctx: ShapeContext, cps: number[]): IndicPlan {
  // Pick the configuration from the first Indic code point.
  let config = INDIC_CONFIGS[0]!
  for (const cp of cps) {
    if (isIndicChar(cp)) {
      config = INDIC_CONFIGS[(cp - 0x0900) >> 7]!
      break
    }
  }
  let scriptTag = ctx.script ?? config.newTag
  // Match HarfBuzz: prefer the OpenType new-spec script tag (e.g. 'knd2') when
  // the font actually provides it, even if the caller passed the old-spec tag
  // ('knda'). Old-spec behaviour (e.g. moving the post-base halant, which breaks
  // below-base 'blwf' matching) applies only when the font lacks the new tag.
  if (config.hasOldSpec && !scriptTag.endsWith('2') && ctx.gsub.hasScript(config.newTag)) {
    scriptTag = config.newTag
  }
  const cacheKey = `${scriptTag}|${ctx.language ?? ''}|${config.blockBase}`
  let byKey = PLAN_CACHE.get(ctx.gsub)
  if (byKey === undefined) {
    byKey = new Map<string, IndicPlan>()
    PLAN_CACHE.set(ctx.gsub, byKey)
  }
  const cached = byKey.get(cacheKey)
  if (cached !== undefined) return cached

  const isOldSpec = config.hasOldSpec && !scriptTag.endsWith('2')
  const isMalayalam = config.blockBase === 0x0D00
  const zeroContext = !isOldSpec && !isMalayalam
  const gsub = ctx.gsub
  const plan: IndicPlan = {
    config,
    scriptTag,
    isOldSpec,
    zeroContext,
    viramaGlyph: ctx.font.getGlyphId(config.virama),
    rphf: gsub.getFeatureLookupIndexList('rphf', scriptTag, ctx.language, ctx.normalizedCoords),
    pref: gsub.getFeatureLookupIndexList('pref', scriptTag, ctx.language, ctx.normalizedCoords),
    blwf: gsub.getFeatureLookupIndexList('blwf', scriptTag, ctx.language, ctx.normalizedCoords),
    pstf: gsub.getFeatureLookupIndexList('pstf', scriptTag, ctx.language, ctx.normalizedCoords),
    vatu: gsub.getFeatureLookupIndexList('vatu', scriptTag, ctx.language, ctx.normalizedCoords),
    consonantPos: new Map<number, number>(),
  }
  byKey.set(cacheKey, plan)
  return plan
}

/**
 * Consonant position from the font: a consonant with a below-base (blwf /
 * vatu), post-base (pstf) or pre-base-reordering (pref) form is not a base
 * candidate. Both Consonant+Virama and Virama+Consonant orders are tested
 * (old- and new-spec lookups both occur in practice).
 */
function consonantPositionFromFont(plan: IndicPlan, ctx: ShapeContext, consonant: number): number {
  const cached = plan.consonantPos.get(consonant)
  if (cached !== undefined) return cached
  const virama = plan.viramaGlyph
  const gsub = ctx.gsub
  let pos = POS_BASE_C
  if (virama !== 0) {
    const vc = [virama, consonant]
    const cv = [consonant, virama]
    if (gsub.wouldSubstitute(plan.blwf, vc, plan.zeroContext) ||
        gsub.wouldSubstitute(plan.blwf, cv, plan.zeroContext) ||
        gsub.wouldSubstitute(plan.vatu, vc, plan.zeroContext) ||
        gsub.wouldSubstitute(plan.vatu, cv, plan.zeroContext)) {
      pos = POS_BELOW_C
    } else if (gsub.wouldSubstitute(plan.pstf, vc, plan.zeroContext) ||
               gsub.wouldSubstitute(plan.pstf, cv, plan.zeroContext) ||
               gsub.wouldSubstitute(plan.pref, vc, plan.zeroContext) ||
               gsub.wouldSubstitute(plan.pref, cv, plan.zeroContext)) {
      pos = POS_POST_C
    }
  }
  plan.consonantPos.set(consonant, pos)
  return pos
}

// --- Initial reordering ---

function initialReorderingSyllable(
  plan: IndicPlan,
  ctx: ShapeContext,
  buf: ComplexBuffer,
  start: number,
  end: number,
): void {
  const type = buf.syllables[start]! & 0x0F
  if (type !== SYL_CONSONANT && type !== SYL_VOWEL &&
      type !== SYL_BROKEN && type !== SYL_STANDALONE) {
    return
  }

  const gsub = ctx.gsub
  const isKannada = plan.config.blockBase === 0x0C80

  // For compatibility with legacy Kannada usage, Ra+H+ZWJ must behave like
  // Ra+ZWJ+H.
  if (isKannada && start + 3 <= end &&
      isOneOf(buf, start, 1 << CAT_Ra) &&
      isOneOf(buf, start + 1, 1 << CAT_H) &&
      isOneOf(buf, start + 2, 1 << CAT_ZWJ)) {
    mergeClusters(buf, start + 1, start + 3)
    moveGlyphBack(buf, start + 2, start + 1)
  }

  // 1. Find the base consonant, and whether the syllable starts with a reph.
  let base = end
  let hasReph = false
  {
    let limit = start
    if (plan.rphf.length > 0 &&
        start + 3 <= end &&
        ((plan.config.rephMode === REPH_MODE_IMPLICIT && !isJoiner(buf, start + 2)) ||
         (plan.config.rephMode === REPH_MODE_EXPLICIT && auxCategory(buf.aux[start + 2]!) === CAT_ZWJ))) {
      const g2 = [buf.glyphs[start]!, buf.glyphs[start + 1]!]
      const g3 = [buf.glyphs[start]!, buf.glyphs[start + 1]!, buf.glyphs[start + 2]!]
      if (gsub.wouldSubstitute(plan.rphf, g2, plan.zeroContext) ||
          (plan.config.rephMode === REPH_MODE_EXPLICIT &&
           gsub.wouldSubstitute(plan.rphf, g3, plan.zeroContext))) {
        limit += 2
        while (limit < end && isJoiner(buf, limit)) limit++
        base = start
        hasReph = true
      }
    } else if (plan.config.rephMode === REPH_MODE_LOG_REPHA &&
               auxCategory(buf.aux[start]!) === CAT_Repha) {
      limit += 1
      while (limit < end && isJoiner(buf, limit)) limit++
      base = start
      hasReph = true
    }

    {
      // Starting from the end of the syllable, move backwards until a
      // consonant without a below-base or post-base form is found.
      let i = end
      let seenBelow = false
      do {
        i--
        if (isConsonant(buf, i)) {
          let pos = auxPosition(buf.aux[i]!)
          if (pos === POS_BASE_C) {
            pos = consonantPositionFromFont(plan, ctx, buf.glyphs[i]!)
            buf.aux[i] = auxWithPosition(buf.aux[i]!, pos)
          }
          if (pos !== POS_BELOW_C && (pos !== POS_POST_C || seenBelow)) {
            base = i
            break
          }
          if (pos === POS_BELOW_C) seenBelow = true
          base = i
        } else {
          // A ZWJ after a halant stops the base search (requests an explicit
          // half form); a ZWJ before a halant requests a subjoined form.
          if (start < i &&
              auxCategory(buf.aux[i]!) === CAT_ZWJ &&
              auxCategory(buf.aux[i - 1]!) === CAT_H) {
            break
          }
        }
      } while (i > limit)
    }

    // With no consonant other than Ra, no reph forms and Ra becomes base.
    if (hasReph && base === start && limit - base <= 2) {
      hasReph = false
    }
  }

  // 2/3. Matra decomposition and canonical mark order are already handled by
  // the normalization pass.

  // Reorder characters: pre-base glyphs, base, reph tag.
  for (let i = start; i < base; i++) {
    const pos = auxPosition(buf.aux[i]!)
    buf.aux[i] = auxWithPosition(buf.aux[i]!, pos < POS_PRE_C ? pos : POS_PRE_C)
  }
  if (base < end) buf.aux[base] = auxWithPosition(buf.aux[base]!, POS_BASE_C)
  if (hasReph) buf.aux[start] = auxWithPosition(buf.aux[start]!, POS_RA_TO_BECOME_REPH)

  // Old-spec: move the first post-base halant after the last consonant.
  if (plan.isOldSpec) {
    const disallowDoubleHalants = isKannada
    for (let i = base + 1; i < end; i++) {
      if (auxCategory(buf.aux[i]!) === CAT_H) {
        let j: number
        for (j = end - 1; j > i; j--) {
          if (isConsonant(buf, j) ||
              (disallowDoubleHalants && auxCategory(buf.aux[j]!) === CAT_H)) {
            break
          }
        }
        if (auxCategory(buf.aux[j]!) !== CAT_H && j > i) {
          moveGlyphForward(buf, i, j)
          mergeClusters(buf, i, j + 1)
        }
        break
      }
    }
  }

  // Attach misc marks to the previous char so they move together.
  {
    let lastPos = POS_START
    const miscFlags = JOINER_FLAGS | (1 << CAT_N) | (1 << CAT_RS) | (1 << CAT_CM) | (1 << CAT_H)
    for (let i = start; i < end; i++) {
      const cat = auxCategory(buf.aux[i]!)
      if (((1 << cat) & miscFlags) !== 0) {
        buf.aux[i] = auxWithPosition(buf.aux[i]!, lastPos)
        if (cat === CAT_H && auxPosition(buf.aux[i]!) === POS_PRE_M) {
          // A halant is not moved with a left matra.
          for (let j = i; j > start; j--) {
            if (auxPosition(buf.aux[j - 1]!) !== POS_PRE_M) {
              buf.aux[i] = auxWithPosition(buf.aux[i]!, auxPosition(buf.aux[j - 1]!))
              break
            }
          }
        }
      } else if (auxPosition(buf.aux[i]!) !== POS_SMVD) {
        if (cat === CAT_MPst && i > start && auxCategory(buf.aux[i - 1]!) === CAT_SM) {
          buf.aux[i - 1] = auxWithPosition(buf.aux[i - 1]!, auxPosition(buf.aux[i]!))
        }
        lastPos = auxPosition(buf.aux[i]!)
      }
    }
  }

  // Post-base consonants own anything before them since the last consonant
  // or matra.
  {
    let last = base
    for (let i = base + 1; i < end; i++) {
      if (isConsonant(buf, i)) {
        for (let j = last + 1; j < i; j++) {
          if (auxPosition(buf.aux[j]!) < POS_SMVD) {
            buf.aux[j] = auxWithPosition(buf.aux[j]!, auxPosition(buf.aux[i]!))
          }
        }
        last = i
      } else if (((1 << auxCategory(buf.aux[i]!)) & ((1 << CAT_M) | (1 << CAT_MPst))) !== 0) {
        last = i
      }
    }
  }

  // Stable sort by position; find base again and flip multi-part left matras.
  {
    const moved = sortByPosition(buf, start, end)
    base = end
    let firstLeftMatra = end
    let lastLeftMatra = end
    for (let i = start; i < end; i++) {
      const pos = auxPosition(buf.aux[i]!)
      if (pos === POS_BASE_C) {
        base = i
        break
      } else if (pos === POS_PRE_M) {
        if (firstLeftMatra === end) firstLeftMatra = i
        lastLeftMatra = i
      }
    }
    if (firstLeftMatra < lastLeftMatra) {
      reverseRange(buf, firstLeftMatra, lastLeftMatra + 1)
      // Reverse back nuktas etc. so each matra keeps its trailing marks.
      let i = firstLeftMatra
      for (let j = i; j <= lastLeftMatra; j++) {
        if (((1 << auxCategory(buf.aux[j]!)) & ((1 << CAT_M) | (1 << CAT_MPst))) !== 0) {
          reverseRange(buf, i, j + 1)
          i = j + 1
        }
      }
    }
    if (moved && base < end) {
      // Post-base glyphs may shuffle arbitrarily; merge their clusters.
      mergeClusters(buf, base, end)
    }
  }

  // Setup feature masks.
  {
    // Reph.
    for (let i = start; i < end && auxPosition(buf.aux[i]!) === POS_RA_TO_BECOME_REPH; i++) {
      buf.masks[i] = buf.masks[i]! | MASK_RPHF
    }
    // Pre-base: half (+ blwf for scripts applying below-forms pre-base).
    let mask = MASK_HALF
    if (!plan.isOldSpec && plan.config.blwfMode === BLWF_MODE_PRE_AND_POST) {
      mask |= MASK_BLWF
    }
    for (let i = start; i < base; i++) buf.masks[i] = buf.masks[i]! | mask
    // Post-base.
    mask = MASK_BLWF | MASK_ABVF | MASK_PSTF
    for (let i = base + 1; i < end; i++) buf.masks[i] = buf.masks[i]! | mask
  }

  // Old-spec Devanagari: below-base form applies to pre-base Ra+H (eyelash Ra).
  if (plan.isOldSpec && plan.config.blockBase === 0x0900) {
    for (let i = start; i + 1 < base; i++) {
      if (auxCategory(buf.aux[i]!) === CAT_Ra &&
          auxCategory(buf.aux[i + 1]!) === CAT_H &&
          (i + 2 === base || auxCategory(buf.aux[i + 2]!) !== CAT_ZWJ)) {
        buf.masks[i] = buf.masks[i]! | MASK_BLWF
        buf.masks[i + 1] = buf.masks[i + 1]! | MASK_BLWF
      }
    }
  }

  // Pre-base-reordering Ra: find a Halant,Ra pair the pref feature would
  // substitute and mark it.
  const prefLen = 2
  if (plan.pref.length > 0 && base + prefLen < end) {
    for (let i = base + 1; i + prefLen - 1 < end; i++) {
      const g = [buf.glyphs[i]!, buf.glyphs[i + 1]!]
      if (gsub.wouldSubstitute(plan.pref, g, plan.zeroContext)) {
        buf.masks[i] = buf.masks[i]! | MASK_PREF
        buf.masks[i + 1] = buf.masks[i + 1]! | MASK_PREF
        break
      }
    }
  }

  // ZWJ/ZWNJ effects: a ZWNJ disables HALF on the preceding consonant run.
  for (let i = start + 1; i < end; i++) {
    if (isJoiner(buf, i)) {
      const nonJoiner = auxCategory(buf.aux[i]!) === CAT_ZWNJ
      let j = i
      do {
        j--
        if (nonJoiner) buf.masks[j] = buf.masks[j]! & ~MASK_HALF
      } while (j > start && !isConsonant(buf, j))
    }
  }
}

// --- Final reordering ---

function finalReorderingSyllable(
  plan: IndicPlan,
  buf: ComplexBuffer,
  start: number,
  end: number,
): void {
  const type = buf.syllables[start]! & 0x0F
  if (type === SYL_SYMBOL || type === SYL_NON_INDIC) return

  const isMalayalam = plan.config.blockBase === 0x0D00
  const isTamil = plan.config.blockBase === 0x0B80

  // Recover the halant category on glyphs that lost it through ligation and
  // multiplication (contextual forms substituting the virama glyph).
  const viramaGlyph = plan.viramaGlyph
  if (viramaGlyph !== 0) {
    for (let i = start; i < end; i++) {
      if (buf.glyphs[i] === viramaGlyph &&
          (buf.flags[i]! & GLYPH_FLAG_LIGATED) !== 0 &&
          (buf.flags[i]! & GLYPH_FLAG_MULTIPLIED) !== 0) {
        buf.aux[i] = auxWithCategory(buf.aux[i]!, CAT_H)
        buf.flags[i] = buf.flags[i]! & ~(GLYPH_FLAG_LIGATED | GLYPH_FLAG_MULTIPLIED)
      }
    }
  }

  let tryPref = plan.pref.length > 0

  // Find base again.
  let base = start
  for (; base < end; base++) {
    if (auxPosition(buf.aux[base]!) >= POS_BASE_C) {
      if (tryPref && base + 1 < end) {
        for (let i = base + 1; i < end; i++) {
          if ((buf.masks[i]! & MASK_PREF) !== 0) {
            if (!((buf.flags[i]! & GLYPH_FLAG_SUBSTITUTED) !== 0 &&
                  (buf.flags[i]! & GLYPH_FLAG_LIGATED) !== 0 &&
                  (buf.flags[i]! & GLYPH_FLAG_MULTIPLIED) === 0)) {
              // A pref candidate that didn't form; base is around here.
              base = i
              while (base < end && isHalant(buf, base)) base++
              if (base < end) buf.aux[base] = auxWithPosition(buf.aux[base]!, POS_BASE_C)
              tryPref = false
            }
            break
          }
        }
        if (base === end) break
      }
      // For Malayalam, skip over unformed below-base forms.
      if (isMalayalam) {
        for (let i = base + 1; i < end; i++) {
          while (i < end && isJoiner(buf, i)) i++
          if (i === end || !isHalant(buf, i)) break
          i++
          while (i < end && isJoiner(buf, i)) i++
          if (i < end && isConsonant(buf, i) && auxPosition(buf.aux[i]!) === POS_BELOW_C) {
            base = i
            buf.aux[base] = auxWithPosition(buf.aux[base]!, POS_BASE_C)
          }
        }
      }
      if (start < base && auxPosition(buf.aux[base]!) > POS_BASE_C) base--
      break
    }
  }
  if (base === end && start < base && isOneOf(buf, base - 1, 1 << CAT_ZWJ)) base--
  if (base < end) {
    while (start < base && isOneOf(buf, base, (1 << CAT_N) | (1 << CAT_H))) base--
  }

  // Reorder pre-base matras: move them after the last standalone halant
  // glyph before the main consonant.
  if (start + 1 < end && start < base) {
    let newPos = base === end ? base - 2 : base - 1

    if (!isMalayalam && !isTamil) {
      let search = true
      while (search) {
        search = false
        while (newPos > start &&
               !isOneOf(buf, newPos, (1 << CAT_M) | (1 << CAT_MPst) | (1 << CAT_H))) {
          newPos--
        }
        if (isHalant(buf, newPos) && auxPosition(buf.aux[newPos]!) !== POS_PRE_M) {
          if (newPos + 1 < end && auxCategory(buf.aux[newPos + 1]!) === CAT_ZWJ) {
            // A ZWJ after the halant blocks repositioning: keep searching.
            if (newPos > start) {
              newPos--
              search = true
            }
          }
        } else {
          newPos = start // No move.
        }
      }
    }

    if (start < newPos && auxPosition(buf.aux[newPos]!) !== POS_PRE_M) {
      for (let i = newPos; i > start; i--) {
        if (auxPosition(buf.aux[i - 1]!) === POS_PRE_M) {
          const oldPos = i - 1
          if (oldPos < base && base <= newPos) base--
          moveGlyphForward(buf, oldPos, newPos)
          mergeClusters(buf, oldPos, Math.min(end, base + 1))
          newPos--
        }
      }
    } else {
      for (let i = start; i < base; i++) {
        if (auxPosition(buf.aux[i]!) === POS_PRE_M) {
          mergeClusters(buf, i, Math.min(end, base + 1))
          break
        }
      }
    }
  }

  // Reorder reph: move a formed reph from the syllable start to its
  // script-specific position.
  const rephLigated = (buf.flags[start]! & GLYPH_FLAG_LIGATED) !== 0 &&
    (buf.flags[start]! & GLYPH_FLAG_MULTIPLIED) === 0
  const rephIsRepha = auxCategory(buf.aux[start]!) === CAT_Repha
  if (start + 1 < end &&
      auxPosition(buf.aux[start]!) === POS_RA_TO_BECOME_REPH &&
      (rephIsRepha !== rephLigated)) {
    let newRephPos = 0
    const rephPos = plan.config.rephPos
    let found = false

    // Step 2 (and 5): after the first explicit halant between the first
    // post-reph consonant and the last main consonant.
    if (rephPos !== POS_AFTER_POST) {
      newRephPos = start + 1
      while (newRephPos < base && !isHalant(buf, newRephPos)) newRephPos++
      if (newRephPos < base && isHalant(buf, newRephPos)) {
        if (newRephPos + 1 < base && isJoiner(buf, newRephPos + 1)) newRephPos++
        found = true
      }
    }

    // Step 3: after the main consonant (for scripts placing reph there).
    if (!found && rephPos === POS_AFTER_MAIN) {
      newRephPos = base
      while (newRephPos + 1 < end && auxPosition(buf.aux[newRephPos + 1]!) <= POS_AFTER_MAIN) {
        newRephPos++
      }
      if (newRephPos < end) found = true
    }

    // Step 4: before the first post-base consonant form.
    if (!found && rephPos === POS_AFTER_SUB) {
      newRephPos = base
      while (newRephPos + 1 < end &&
             (((1 << auxPosition(buf.aux[newRephPos + 1]!)) &
               ((1 << POS_POST_C) | (1 << POS_AFTER_POST) | (1 << POS_SMVD))) === 0)) {
        newRephPos++
      }
      if (newRephPos < end) found = true
    }

    // Step 5 for after-post scripts: same as step 2.
    if (!found && rephPos === POS_AFTER_POST) {
      newRephPos = start + 1
      while (newRephPos < base && !isHalant(buf, newRephPos)) newRephPos++
      if (newRephPos < base && isHalant(buf, newRephPos)) {
        if (newRephPos + 1 < base && isJoiner(buf, newRephPos + 1)) newRephPos++
        found = true
      }
    }

    // Step 6: move reph to the end of the syllable.
    if (!found) {
      newRephPos = end - 1
      while (newRephPos > start && auxPosition(buf.aux[newRephPos]!) === POS_SMVD) newRephPos--
      // If the reph lands after a Matra,Halant sequence, position it before
      // the halant so it can interact with the matra.
      if (isHalant(buf, newRephPos)) {
        for (let i = base + 1; i < newRephPos; i++) {
          if (((1 << auxCategory(buf.aux[i]!)) & ((1 << CAT_M) | (1 << CAT_MPst))) !== 0) {
            newRephPos--
          }
        }
      }
    }

    mergeClusters(buf, start, newRephPos + 1)
    moveGlyphForward(buf, start, newRephPos)
    if (start < base && base <= newRephPos) base--
  }

  // Reorder pre-base-reordering consonants: a glyph the pref feature ligated
  // moves to the pre-base matra position.
  if (tryPref && base + 1 < end) {
    for (let i = base + 1; i < end; i++) {
      if ((buf.masks[i]! & MASK_PREF) !== 0) {
        if ((buf.flags[i]! & GLYPH_FLAG_LIGATED) !== 0 &&
            (buf.flags[i]! & GLYPH_FLAG_MULTIPLIED) === 0) {
          let newPos = base
          if (!isMalayalam && !isTamil) {
            while (newPos > start &&
                   !isOneOf(buf, newPos - 1, (1 << CAT_M) | (1 << CAT_MPst) | (1 << CAT_H))) {
              newPos--
            }
          }
          if (newPos > start && isHalant(buf, newPos - 1)) {
            if (newPos < end && isJoiner(buf, newPos)) newPos++
          }
          const oldPos = i
          mergeClusters(buf, newPos, oldPos + 1)
          moveGlyphBack(buf, oldPos, newPos)
          if (newPos <= base && base < oldPos) base++
        }
        break
      }
    }
  }

  // Apply init to a word-initial left matra.
  if (auxPosition(buf.aux[start]!) === POS_PRE_M &&
      (buf.aux[start]! & AUX_INIT_BLOCKED) === 0) {
    buf.masks[start] = buf.masks[start]! | MASK_INIT
  }
}

// --- Shaper entry point ---

/**
 * Indic-specific normalization: decompose composites (skipping the shaper
 * exceptions), reorder combining marks, then recompose pairs the font
 * supports (marks never recompose with a preceding mark; the Bengali
 * YA+NUKTA=YYA exclusion is recomposed on purpose).
 */
export function normalizeIndic(
  ctx: ShapeContext,
  cps: number[],
  clusters: number[],
  recomposeSplitMatras = false,
  sourceClusters?: number[],
): void {
  // Decompose (recursively; canonical decompositions in the Indic blocks).
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!
    // Shaper exceptions: these do not decompose.
    if (cp === 0x0931 || cp === 0x09DC || cp === 0x09DD || cp === 0x0B94) continue
    const d = getIndicDecomposition(cp)
    if (d === null) continue
    if (d[1] === 0) {
      cps[i] = d[0]
      i-- // The replacement may decompose further.
      continue
    }
    cps.splice(i, 1, d[0], d[1])
    clusters.splice(i, 1, clusters[i]!, 0)
    if (sourceClusters !== undefined) sourceClusters.splice(i, 1, sourceClusters[i]!, sourceClusters[i]!)
    i-- // Re-examine the first part for nested decompositions.
  }

  reorderMarkRuns(cps, clusters, sourceClusters)

  // Recompose starter + mark pairs when the composed form is not excluded
  // and the font has a glyph for it. A combining mark never starts a
  // recomposition, so split matras stay decomposed.
  for (let i = 0; i + 1 < cps.length; i++) {
    const a = cps[i]!
    const b = cps[i + 1]!
    // The GSUB path keeps split matras decomposed (a mark never starts a
    // recomposition). The AAT 'morx' path instead wants the precomposed matra —
    // Apple's morx state machines match against it and split/reorder internally,
    // as HarfBuzz feeds them (its normalizer recomposes for AAT). So allow a mark
    // starter when recomposing for AAT.
    if (isMarkCp(a) && !recomposeSplitMatras) continue
    let composed = composeIndicPair(a, b)
    if (composed === 0 && a === 0x09AF && b === 0x09BC) composed = 0x09DF
    if (composed === 0) continue
    if (ctx.font.getGlyphId(composed) === 0) continue
    cps.splice(i, 2, composed)
    const merged = clusters[i]! + clusters[i + 1]!
    clusters.splice(i, 2, merged)
    if (sourceClusters !== undefined) {
      sourceClusters.splice(i, 2, Math.min(sourceClusters[i]!, sourceClusters[i + 1]!))
    }
    i--
  }
}

/** Whether the code point is a combining mark for recomposition purposes. */
function isMarkCp(cp: number): boolean {
  const cat = auxCategory(getShapingClass(cp))
  return cat === CAT_M || cat === CAT_MPst || cat === CAT_N || cat === CAT_SM ||
         cat === CAT_A || cat === CAT_H || cat === CAT_RS
}

/** GSUB feature stages (built once). */
const STAGE_LOCL_CCMP: GsubShapingFeature[] = [
  { tag: 'locl', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'ccmp', mask: GSUB_MASK_GLOBAL, perSyllable: true },
]

const BASIC_STAGES: GsubShapingFeature[][] = [
  [{ tag: 'nukt', mask: GSUB_MASK_GLOBAL, perSyllable: true }],
  [{ tag: 'akhn', mask: GSUB_MASK_GLOBAL, perSyllable: true }],
  [{ tag: 'rphf', mask: MASK_RPHF, perSyllable: true }],
  [{ tag: 'rkrf', mask: GSUB_MASK_GLOBAL, perSyllable: true }],
  [{ tag: 'pref', mask: MASK_PREF, perSyllable: true }],
  [{ tag: 'blwf', mask: MASK_BLWF, perSyllable: true }],
  [{ tag: 'abvf', mask: MASK_ABVF, perSyllable: true }],
  [{ tag: 'half', mask: MASK_HALF, perSyllable: true }],
  [{ tag: 'pstf', mask: MASK_PSTF, perSyllable: true }],
  [{ tag: 'vatu', mask: GSUB_MASK_GLOBAL, perSyllable: true }],
  [{ tag: 'cjct', mask: GSUB_MASK_GLOBAL, perSyllable: true }],
]

const FINAL_FEATURES: GsubShapingFeature[] = [
  { tag: 'init', mask: MASK_INIT, perSyllable: true },
  { tag: 'pres', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'abvs', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'blws', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'psts', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'haln', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  // Common discretionary features ('liga' is disabled for Indic scripts).
  { tag: 'rlig', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'calt', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'clig', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'rclt', mask: GSUB_MASK_GLOBAL, perSyllable: false },
]

/** Feature tags already handled by the built-in Indic stages. */
const INDIC_BUILTIN_TAGS = new Set([
  'locl', 'ccmp', 'nukt', 'akhn', 'rphf', 'rkrf', 'pref', 'blwf', 'abvf',
  'half', 'pstf', 'vatu', 'cjct', 'init', 'pres', 'abvs', 'blws', 'psts',
  'haln', 'rlig', 'calt', 'clig', 'rclt', 'liga',
])

/**
 * Shape an Indic-script code point sequence into glyphs.
 * @returns glyph ids with per-glyph source cluster counts
 */
export function shapeIndic(
  ctx: ShapeContext,
  cps: number[],
  charClusters: number[] | null,
  charSourceClusters: number[] | null = null,
): { glyphIds: number[], clusters: number[], sourceClusters: number[], flags: number[] } {
  const clusters = charClusters ?? new Array<number>(cps.length)
  if (charClusters === null) {
    for (let i = 0; i < cps.length; i++) clusters[i] = 1
  }
  const sourceClusters = charSourceClusters ?? cps.map((_cp, index) => index)
  normalizeIndic(ctx, cps, clusters, false, sourceClusters)

  const plan = createIndicPlan(ctx, cps)
  const buf = buildComplexBuffer(ctx.font, cps, clusters, sourceClusters)
  const hasBroken = findSyllables(buf, INDIC_SCANNER, SYL_BROKEN, SYL_NON_INDIC)

  // Stage: locl + ccmp.
  ctx.gsub.applyShapingFeatures(buf, STAGE_LOCL_CCMP, plan.scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  // Insert dotted circles into broken clusters (after a leading repha).
  if (hasBroken) {
    const dcGlyph = ctx.font.getGlyphId(0x25CC)
    if (dcGlyph !== 0) {
      let lastSyllable = 0
      for (let i = 0; i < buf.glyphs.length; i++) {
        const syllable = buf.syllables[i]!
        if (syllable !== lastSyllable && (syllable & 0x0F) === SYL_BROKEN) {
          lastSyllable = syllable
          let at = i
          while (at < buf.glyphs.length && buf.syllables[at] === syllable &&
                 auxCategory(buf.aux[at]!) === CAT_Repha) {
            at++
          }
          insertGlyph(buf, at, dcGlyph, buf.masks[i]!, 0, syllable,
            CAT_DOTTEDCIRCLE | (POS_END << 8))
        } else {
          lastSyllable = syllable
        }
      }
    }
  }

  // Initial reordering per syllable.
  for (let start = 0; start < buf.glyphs.length;) {
    let end = start + 1
    while (end < buf.glyphs.length && buf.syllables[end] === buf.syllables[start]) end++
    initialReorderingSyllable(plan, ctx, buf, start, end)
    start = end
  }

  // Basic features, one stage at a time.
  for (const stage of BASIC_STAGES) {
    ctx.gsub.applyShapingFeatures(buf, stage, plan.scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)
  }

  // Final reordering per syllable.
  for (let start = 0; start < buf.glyphs.length;) {
    let end = start + 1
    while (end < buf.glyphs.length && buf.syllables[end] === buf.syllables[start]) end++
    finalReorderingSyllable(plan, buf, start, end)
    start = end
  }

  // Presentation features plus any extra user-requested GSUB features.
  const finalFeatures = appendUserShapingFeatures(FINAL_FEATURES, INDIC_BUILTIN_TAGS, ctx)
  ctx.gsub.applyShapingFeatures(buf, finalFeatures, plan.scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  return { glyphIds: buf.glyphs, clusters: buf.clusters, sourceClusters: buf.sourceClusters, flags: buf.flags }
}
