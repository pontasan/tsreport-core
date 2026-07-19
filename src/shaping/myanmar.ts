/**
 * Myanmar shaper.
 *
 * Reordering happens after locl/ccmp and before the basic features:
 *  - A syllable-initial kinzi (Ra + Asat + Halant) is tagged POS_AFTER_MAIN
 *    and moves after the base consonant.
 *  - Medial Ra (pre-base-reordering) and pre-base vowels move before the
 *    base.
 *  - Below/above/post material is bucketed into visual positions and the
 *    syllable is sorted by position.
 * The basic features (rphf, pref, blwf, pstf) then apply one stage at a
 * time, globally within each syllable.
 */

import type { GsubShapingFeature } from '../parsers/tables/gsub.js'
import { GSUB_MASK_GLOBAL, GLYPH_FLAG_LIGATED } from '../parsers/tables/gsub.js'
import {
  CAT_C, CAT_V, CAT_N, CAT_H, CAT_ZWNJ, CAT_ZWJ, CAT_SM, CAT_A,
  CAT_PLACEHOLDER, CAT_DOTTEDCIRCLE, CAT_Ra, CAT_CS, CAT_SMPst,
  CAT_VAbv, CAT_VBlw, CAT_VPre, CAT_VPst,
  CAT_As, CAT_MH, CAT_MR, CAT_MW, CAT_MY, CAT_PT, CAT_VS, CAT_ML,
  POS_PRE_M, POS_PRE_C, POS_BASE_C, POS_AFTER_MAIN, POS_BEFORE_SUB,
  POS_BELOW_C, POS_AFTER_SUB, POS_END,
} from './ot-categories.js'
import {
  type ComplexBuffer, type ShapeContext,
  auxCategory, auxPosition, auxWithPosition, buildComplexBuffer, findSyllables,
  mergeClusters, reverseRange, sortByPosition, insertGlyph, appendUserShapingFeatures,
} from './complex.js'
import { SyllableGrammar, type SyllableScanner } from './syllable-machine.js'
import { reorderMarkRuns } from './normalize.js'
import { getUnicodeScript } from './unicode-shaping-properties.js'

/** Whether the code point belongs to a Myanmar block. */
export function isMyanmarChar(cp: number): boolean {
  return getUnicodeScript(cp) === 'Myanmar'
}

// --- Syllable machine (Myanmar grammar) ---

const SYL_CONSONANT = 1
const SYL_BROKEN = 2
const SYL_NON_MYANMAR = 3

function buildMyanmarScanner(): SyllableScanner {
  const g = new SyllableGrammar()

  const j = () => g.cat([CAT_ZWJ, CAT_ZWNJ])
  const k = () => g.seq(g.cat([CAT_Ra]), g.cat([CAT_As]), g.cat([CAT_H]))
  const sm = () => g.cat([CAT_SM, CAT_SMPst])
  const c = () => g.cat([CAT_C, CAT_Ra])

  const medialGroup = () => g.seq(
    g.opt(g.cat([CAT_MY])),
    g.opt(g.cat([CAT_As])),
    g.opt(g.cat([CAT_MR])),
    g.opt(g.seq(
      g.alt(
        g.seq(g.cat([CAT_MW]), g.opt(g.cat([CAT_MH])), g.opt(g.cat([CAT_ML]))),
        g.seq(g.cat([CAT_MH]), g.opt(g.cat([CAT_ML]))),
        g.cat([CAT_ML]),
      ),
      g.opt(g.cat([CAT_As])),
    )),
  )
  const mainVowelGroup = () => g.seq(
    g.star(g.seq(g.cat([CAT_VPre]), g.opt(g.cat([CAT_VS])))),
    g.star(g.cat([CAT_VAbv])),
    g.star(g.cat([CAT_VBlw])),
    g.star(g.cat([CAT_A])),
    g.opt(g.seq(g.cat([CAT_N]), g.opt(g.cat([CAT_As])))),
  )
  const postVowelGroup = () => g.seq(
    g.cat([CAT_VPst]),
    g.opt(g.cat([CAT_MH])),
    g.opt(g.cat([CAT_ML])),
    g.star(g.cat([CAT_As])),
    g.star(g.cat([CAT_VAbv])),
    g.star(g.cat([CAT_A])),
    g.opt(g.seq(g.cat([CAT_N]), g.opt(g.cat([CAT_As])))),
  )
  const toneGroup = () => g.alt(
    sm(),
    g.seq(g.cat([CAT_PT]), g.star(g.cat([CAT_A])), g.opt(g.cat([CAT_N])), g.opt(g.cat([CAT_As]))),
  )
  const complexSyllableTail = () => g.seq(
    g.star(g.cat([CAT_As])),
    medialGroup(),
    mainVowelGroup(),
    g.star(postVowelGroup()),
    g.star(toneGroup()),
    g.opt(j()),
  )
  const syllableTail = () => g.seq(
    g.star(g.seq(g.cat([CAT_H]), g.alt(c(), g.cat([CAT_V])), g.opt(g.cat([CAT_VS])))),
    g.alt(g.cat([CAT_H]), complexSyllableTail()),
  )

  const consonantSyllable = g.seq(
    g.opt(g.alt(k(), g.cat([CAT_CS]))),
    g.cat([CAT_C, CAT_Ra, CAT_V, CAT_PLACEHOLDER, CAT_DOTTEDCIRCLE]),
    g.opt(g.cat([CAT_VS])),
    syllableTail(),
  )
  const brokenCluster = g.seq(
    g.opt(k()),
    g.opt(g.cat([CAT_VS])),
    syllableTail(),
  )

  g.token(consonantSyllable, SYL_CONSONANT)
  g.token(g.cat([CAT_ZWJ, CAT_ZWNJ, CAT_SMPst]), SYL_NON_MYANMAR)
  g.token(brokenCluster, SYL_BROKEN)

  return g.build()
}

const MYANMAR_SCANNER = buildMyanmarScanner()

// --- Reordering ---

const CONSONANT_FLAGS_MYANMAR =
  (1 << CAT_C) | (1 << CAT_CS) | (1 << CAT_Ra) | (1 << CAT_V) |
  (1 << CAT_PLACEHOLDER) | (1 << CAT_DOTTEDCIRCLE)

function isConsonantMyanmar(buf: ComplexBuffer, i: number): boolean {
  if ((buf.flags[i]! & GLYPH_FLAG_LIGATED) !== 0) return false
  return ((1 << auxCategory(buf.aux[i]!)) & CONSONANT_FLAGS_MYANMAR) !== 0
}

function reorderSyllableMyanmar(buf: ComplexBuffer, start: number, end: number): void {
  const type = buf.syllables[start]! & 0x0F
  if (type !== SYL_CONSONANT && type !== SYL_BROKEN) return

  let base = end
  let hasReph = false
  {
    let limit = start
    if (start + 3 <= end &&
        auxCategory(buf.aux[start]!) === CAT_Ra &&
        auxCategory(buf.aux[start + 1]!) === CAT_As &&
        auxCategory(buf.aux[start + 2]!) === CAT_H) {
      limit += 3
      base = start
      hasReph = true
    }
    if (!hasReph) base = limit
    for (let i = limit; i < end; i++) {
      if (isConsonantMyanmar(buf, i)) {
        base = i
        break
      }
    }
  }

  // Assign positions.
  {
    let i = start
    for (; i < start + (hasReph ? 3 : 0); i++) {
      buf.aux[i] = auxWithPosition(buf.aux[i]!, POS_AFTER_MAIN)
    }
    for (; i < base; i++) {
      buf.aux[i] = auxWithPosition(buf.aux[i]!, POS_PRE_C)
    }
    if (i < end) {
      buf.aux[i] = auxWithPosition(buf.aux[i]!, POS_BASE_C)
      i++
    }
    let pos = POS_AFTER_MAIN
    for (; i < end; i++) {
      const cat = auxCategory(buf.aux[i]!)
      if (cat === CAT_MR) { // Pre-base-reordering medial Ra
        buf.aux[i] = auxWithPosition(buf.aux[i]!, POS_PRE_C)
        continue
      }
      if (cat === CAT_VPre) { // Left matra
        buf.aux[i] = auxWithPosition(buf.aux[i]!, POS_PRE_M)
        continue
      }
      if (cat === CAT_VS) {
        buf.aux[i] = auxWithPosition(buf.aux[i]!, auxPosition(buf.aux[i - 1]!))
        continue
      }
      if (pos === POS_AFTER_MAIN && cat === CAT_VBlw) {
        pos = POS_BELOW_C
        buf.aux[i] = auxWithPosition(buf.aux[i]!, pos)
        continue
      }
      if (pos === POS_BELOW_C && cat === CAT_A) {
        buf.aux[i] = auxWithPosition(buf.aux[i]!, POS_BEFORE_SUB)
        continue
      }
      if (pos === POS_BELOW_C && cat === CAT_VBlw) {
        buf.aux[i] = auxWithPosition(buf.aux[i]!, pos)
        continue
      }
      if (pos === POS_BELOW_C && cat !== CAT_A) {
        pos = POS_AFTER_SUB
        buf.aux[i] = auxWithPosition(buf.aux[i]!, pos)
        continue
      }
      buf.aux[i] = auxWithPosition(buf.aux[i]!, pos)
    }
  }

  // Sort by position and merge the clusters of anything that moved.
  if (sortByPosition(buf, start, end)) {
    mergeClusters(buf, start, end)
  }

  // Flip a multi-part left-matra sequence back into logical order.
  let firstLeftMatra = end
  let lastLeftMatra = end
  for (let i = start; i < end; i++) {
    if (auxPosition(buf.aux[i]!) === POS_PRE_M) {
      if (firstLeftMatra === end) firstLeftMatra = i
      lastLeftMatra = i
    }
  }
  if (firstLeftMatra < lastLeftMatra) {
    reverseRange(buf, firstLeftMatra, lastLeftMatra + 1)
    let i = firstLeftMatra
    for (let j = i; j <= lastLeftMatra; j++) {
      if (auxCategory(buf.aux[j]!) === CAT_VPre) {
        reverseRange(buf, i, j + 1)
        i = j + 1
      }
    }
  }
}

// --- Shaper entry point ---

const MYANMAR_STAGE_LOCL_CCMP: GsubShapingFeature[] = [
  { tag: 'locl', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'ccmp', mask: GSUB_MASK_GLOBAL, perSyllable: true },
]

const MYANMAR_BASIC_STAGES: GsubShapingFeature[][] = [
  [{ tag: 'rphf', mask: GSUB_MASK_GLOBAL, perSyllable: true }],
  [{ tag: 'pref', mask: GSUB_MASK_GLOBAL, perSyllable: true }],
  [{ tag: 'blwf', mask: GSUB_MASK_GLOBAL, perSyllable: true }],
  [{ tag: 'pstf', mask: GSUB_MASK_GLOBAL, perSyllable: true }],
]

const MYANMAR_FINAL_FEATURES: GsubShapingFeature[] = [
  { tag: 'pres', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'abvs', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'blws', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'psts', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  // Common discretionary features (liga stays enabled for Myanmar).
  { tag: 'rlig', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'calt', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'clig', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'liga', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'rclt', mask: GSUB_MASK_GLOBAL, perSyllable: false },
]

const MYANMAR_BUILTIN_TAGS = new Set([
  'locl', 'ccmp', 'rphf', 'pref', 'blwf', 'pstf',
  'pres', 'abvs', 'blws', 'psts', 'rlig', 'calt', 'clig', 'liga', 'rclt',
])

/**
 * Shape a Myanmar code point sequence into glyphs.
 * @returns glyph ids with per-glyph source cluster counts; marks classified
 *          by the GDEF table should get zero advance width (early mark
 *          zeroing model for this script)
 */
export function shapeMyanmar(
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
  reorderMarkRuns(cps, clusters, sourceClusters)

  const scriptTag = ctx.script ?? 'mym2'
  const buf = buildComplexBuffer(ctx.font, cps, clusters, sourceClusters)
  const hasBroken = findSyllables(buf, MYANMAR_SCANNER, SYL_BROKEN, SYL_NON_MYANMAR)

  ctx.gsub.applyShapingFeatures(buf, MYANMAR_STAGE_LOCL_CCMP, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  // Insert dotted circles into broken clusters.
  if (hasBroken) {
    const dcGlyph = ctx.font.getGlyphId(0x25CC)
    if (dcGlyph !== 0) {
      let lastSyllable = 0
      for (let i = 0; i < buf.glyphs.length; i++) {
        const syllable = buf.syllables[i]!
        if (syllable !== lastSyllable && (syllable & 0x0F) === SYL_BROKEN) {
          insertGlyph(buf, i, dcGlyph, buf.masks[i]!, 0, syllable,
            CAT_DOTTEDCIRCLE | (POS_END << 8))
          i++
        }
        lastSyllable = syllable
      }
    }
  }

  // Reorder each syllable.
  for (let start = 0; start < buf.glyphs.length;) {
    let end = start + 1
    while (end < buf.glyphs.length && buf.syllables[end] === buf.syllables[start]) end++
    reorderSyllableMyanmar(buf, start, end)
    start = end
  }

  for (const stage of MYANMAR_BASIC_STAGES) {
    ctx.gsub.applyShapingFeatures(buf, stage, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)
  }

  const finalFeatures = appendUserShapingFeatures(MYANMAR_FINAL_FEATURES, MYANMAR_BUILTIN_TAGS, ctx)
  ctx.gsub.applyShapingFeatures(buf, finalFeatures, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  return { glyphIds: buf.glyphs, clusters: buf.clusters, sourceClusters: buf.sourceClusters, flags: buf.flags }
}
