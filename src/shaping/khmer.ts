/**
 * Khmer shaper.
 *
 * Khmer differs from the Indic model: the base is always the first
 * consonant, below-base forms are written with a visible coeng (U+17D2)
 * followed by the consonant, and reordering happens before any basic
 * features are applied (the basic features run in a single stage together
 * with locl/ccmp, matching observed engine behavior):
 *  - Coeng+Ro moves to the syllable start and takes the pref feature; the
 *    remainder of the syllable takes cfar.
 *  - Pre-base vowels (VPre) move to the syllable start.
 */

import type { GsubShapingFeature } from '../parsers/tables/gsub.js'
import { GSUB_MASK_GLOBAL } from '../parsers/tables/gsub.js'
import {
  CAT_C, CAT_V, CAT_H, CAT_ZWNJ, CAT_ZWJ, CAT_PLACEHOLDER, CAT_DOTTEDCIRCLE,
  CAT_Ra, CAT_VAbv, CAT_VBlw, CAT_VPre, CAT_VPst, CAT_Robatic, CAT_Xgroup,
  CAT_Ygroup, POS_END,
} from './ot-categories.js'
import {
  type ComplexBuffer, type ShapeContext,
  auxCategory, buildComplexBuffer, findSyllables, mergeClusters, moveGlyphBack, insertGlyph,
  appendUserShapingFeatures,
} from './complex.js'
import { SyllableGrammar, type SyllableScanner } from './syllable-machine.js'
import { reorderMarkRuns } from './normalize.js'
import { getUnicodeScript } from './unicode-shaping-properties.js'

// --- Feature masks ---

const MASK_PREF = 1 << 1
const MASK_BLWF = 1 << 2
const MASK_ABVF = 1 << 3
const MASK_PSTF = 1 << 4
const MASK_CFAR = 1 << 5

/** Whether the code point belongs to the Khmer block. */
export function isKhmerChar(cp: number): boolean {
  return getUnicodeScript(cp) === 'Khmer'
}

// --- Syllable machine (Khmer grammar) ---

const SYL_CONSONANT = 1
const SYL_BROKEN = 2
const SYL_NON_KHMER = 3

function buildKhmerScanner(): SyllableScanner {
  const g = new SyllableGrammar()

  const c = () => g.cat([CAT_C, CAT_Ra, CAT_V])
  const cn = () => g.seq(
    c(),
    g.opt(g.seq(g.opt(g.cat([CAT_ZWJ, CAT_ZWNJ])), g.cat([CAT_Robatic]))),
  )
  const joiner = () => g.cat([CAT_ZWJ, CAT_ZWNJ])
  const xgroup = () => g.star(g.seq(g.star(joiner()), g.cat([CAT_Xgroup])))
  const ygroup = () => g.star(g.cat([CAT_Ygroup]))
  const matraGroup = () => g.seq(
    g.opt(g.cat([CAT_VPre])), xgroup(),
    g.opt(g.cat([CAT_VBlw])), xgroup(),
    g.opt(g.seq(g.opt(joiner()), g.cat([CAT_VAbv]))), xgroup(),
    g.opt(g.cat([CAT_VPst])),
  )
  const syllableTail = () => g.seq(
    xgroup(), matraGroup(), xgroup(),
    g.opt(g.seq(g.cat([CAT_H]), c())),
    ygroup(),
  )
  const brokenCluster = () => g.seq(
    g.opt(g.cat([CAT_Robatic])),
    g.star(g.seq(g.cat([CAT_H]), cn())),
    g.alt(g.cat([CAT_H]), syllableTail()),
  )

  const consonantSyllable = g.seq(
    g.alt(cn(), g.cat([CAT_PLACEHOLDER, CAT_DOTTEDCIRCLE])),
    brokenCluster(),
  )

  g.token(consonantSyllable, SYL_CONSONANT)
  g.token(brokenCluster(), SYL_BROKEN)

  return g.build()
}

const KHMER_SCANNER = buildKhmerScanner()

// --- Reordering ---

function reorderSyllableKhmer(buf: ComplexBuffer, start: number, end: number): void {
  const type = buf.syllables[start]! & 0x0F
  if (type !== SYL_CONSONANT && type !== SYL_BROKEN) return

  // Post-base glyphs may take the below/above/post-base forms.
  for (let i = start + 1; i < end; i++) {
    buf.masks[i] = buf.masks[i]! | (MASK_BLWF | MASK_ABVF | MASK_PSTF)
  }

  let numCoengs = 0
  for (let i = start + 1; i < end; i++) {
    if (auxCategory(buf.aux[i]!) === CAT_H && numCoengs <= 2 && i + 1 < end) {
      numCoengs++
      if (auxCategory(buf.aux[i + 1]!) === CAT_Ra) {
        // Coeng+Ro: mark with pref and move to the syllable start; the
        // following glyphs take cfar (they follow the reordered Ro).
        buf.masks[i] = buf.masks[i]! | MASK_PREF
        buf.masks[i + 1] = buf.masks[i + 1]! | MASK_PREF
        mergeClusters(buf, start, i + 2)
        moveGlyphBack(buf, i, start)
        moveGlyphBack(buf, i + 1, start + 1)
        for (let j = i + 2; j < end; j++) {
          buf.masks[j] = buf.masks[j]! | MASK_CFAR
        }
        numCoengs = 2 // Done.
      }
    } else if (auxCategory(buf.aux[i]!) === CAT_VPre) {
      // Pre-base vowel: move to the syllable start.
      mergeClusters(buf, start, i + 1)
      moveGlyphBack(buf, i, start)
    }
  }
}

// --- Shaper entry point ---

/** Basic stage: locl/ccmp and the basic features run together (no pauses). */
const KHMER_BASIC_STAGE: GsubShapingFeature[] = [
  { tag: 'locl', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'ccmp', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'pref', mask: MASK_PREF, perSyllable: true },
  { tag: 'blwf', mask: MASK_BLWF, perSyllable: true },
  { tag: 'abvf', mask: MASK_ABVF, perSyllable: true },
  { tag: 'pstf', mask: MASK_PSTF, perSyllable: true },
  { tag: 'cfar', mask: MASK_CFAR, perSyllable: true },
]

const KHMER_FINAL_FEATURES: GsubShapingFeature[] = [
  { tag: 'pres', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'abvs', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'blws', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'psts', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  // Common discretionary features; clig is a required Khmer shaping feature
  // and liga is disabled for Khmer.
  { tag: 'rlig', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'calt', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'clig', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'rclt', mask: GSUB_MASK_GLOBAL, perSyllable: false },
]

const KHMER_BUILTIN_TAGS = new Set([
  'locl', 'ccmp', 'pref', 'blwf', 'abvf', 'pstf', 'cfar',
  'pres', 'abvs', 'blws', 'psts', 'rlig', 'calt', 'clig', 'rclt', 'liga',
])

/**
 * Khmer normalization: decompose the split matras (they are visual
 * composites of U+17C1 plus the right/upper part; Unicode has no canonical
 * decompositions for them) and reorder combining marks. Split matras never
 * recompose.
 */
function normalizeKhmer(cps: number[], clusters: number[], sourceClusters?: number[]): void {
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!
    if (cp === 0x17BE || cp === 0x17BF || cp === 0x17C0 || cp === 0x17C4 || cp === 0x17C5) {
      cps.splice(i, 0, 0x17C1)
      clusters.splice(i + 1, 0, 0)
      if (sourceClusters !== undefined) sourceClusters.splice(i, 0, sourceClusters[i]!)
      i++
    }
  }
  reorderMarkRuns(cps, clusters, sourceClusters)
}

/**
 * Shape a Khmer code point sequence into glyphs.
 * @returns glyph ids with per-glyph source cluster counts
 */
export function shapeKhmer(
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
  normalizeKhmer(cps, clusters, sourceClusters)

  const scriptTag = ctx.script ?? 'khmr'
  const buf = buildComplexBuffer(ctx.font, cps, clusters, sourceClusters)
  const hasBroken = findSyllables(buf, KHMER_SCANNER, SYL_BROKEN, SYL_NON_KHMER)

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

  // Reordering happens before any features are applied.
  for (let start = 0; start < buf.glyphs.length;) {
    let end = start + 1
    while (end < buf.glyphs.length && buf.syllables[end] === buf.syllables[start]) end++
    reorderSyllableKhmer(buf, start, end)
    start = end
  }

  ctx.gsub.applyShapingFeatures(buf, KHMER_BASIC_STAGE, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  const finalFeatures = appendUserShapingFeatures(KHMER_FINAL_FEATURES, KHMER_BUILTIN_TAGS, ctx)
  ctx.gsub.applyShapingFeatures(buf, finalFeatures, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  return { glyphIds: buf.glyphs, clusters: buf.clusters, sourceClusters: buf.sourceClusters, flags: buf.flags }
}
