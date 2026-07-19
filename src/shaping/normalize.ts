/**
 * Unicode normalization pieces used by text shaping.
 *
 * Shaping does not need full NFC/NFD: fonts carry glyphs for the composed
 * forms, so the pipeline only (a) reorders combining-mark runs into canonical
 * order and (b) decomposes/recomposes the script-specific composites the
 * complex shapers care about (Indic split matras and nukta composites).
 *
 * Mark reordering uses the shaping-oriented modified combining classes
 * (Arabic shadda before vowel marks, SBL Hebrew mark order, Telugu length
 * marks below the halant, Thai sara u/uu before phinthu) rather than the raw
 * canonical classes, matching the behavior of mainstream shaping engines.
 */

import { CCC_RANGES, INDIC_DECOMP, MN_RANGES } from './unicode-tables.js'

const CCC_RANGE_COUNT = CCC_RANGES.length / 3
const MN_RANGE_COUNT = MN_RANGES.length / 2

/** General_Category == Mn (Nonspacing_Mark). */
export function isNonspacingMark(cp: number): boolean {
  let lo = 0
  let hi = MN_RANGE_COUNT - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const base = mid * 2
    if (cp < MN_RANGES[base]!) {
      hi = mid - 1
    } else if (cp > MN_RANGES[base + 1]!) {
      lo = mid + 1
    } else {
      return true
    }
  }
  return false
}

/** Canonical_Combining_Class of a code point (0 when not listed). */
export function getCombiningClass(cp: number): number {
  let lo = 0
  let hi = CCC_RANGE_COUNT - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const base = mid * 3
    if (cp < CCC_RANGES[base]!) {
      hi = mid - 1
    } else if (cp > CCC_RANGES[base + 1]!) {
      lo = mid + 1
    } else {
      return CCC_RANGES[base + 2]!
    }
  }
  return 0
}

/**
 * Remap table from canonical to modified combining classes:
 * - Hebrew fixed-position classes 10..26 permuted into SBL Hebrew order.
 * - Arabic 27..35 permuted so shadda (33) sorts before the vowel marks.
 * - Telugu length marks 84 / 91 mapped below the halant (9) to 4 / 5.
 * - Thai sara u / sara uu (103) mapped before phinthu (9) to 3.
 * - Tibetan vowel signs 130 / 132 swapped so sign u sorts first.
 */
const MODIFIED_CCC = new Uint8Array(256)
for (let i = 0; i < 256; i++) MODIFIED_CCC[i] = i
MODIFIED_CCC[10] = 22
MODIFIED_CCC[11] = 15
MODIFIED_CCC[12] = 16
MODIFIED_CCC[13] = 17
MODIFIED_CCC[14] = 23
MODIFIED_CCC[15] = 18
MODIFIED_CCC[16] = 19
MODIFIED_CCC[17] = 20
MODIFIED_CCC[18] = 21
MODIFIED_CCC[19] = 14
MODIFIED_CCC[20] = 24
MODIFIED_CCC[21] = 12
MODIFIED_CCC[22] = 25
MODIFIED_CCC[23] = 13
MODIFIED_CCC[24] = 10
MODIFIED_CCC[25] = 11
MODIFIED_CCC[27] = 28
MODIFIED_CCC[28] = 29
MODIFIED_CCC[29] = 30
MODIFIED_CCC[30] = 31
MODIFIED_CCC[31] = 32
MODIFIED_CCC[32] = 33
MODIFIED_CCC[33] = 27
MODIFIED_CCC[84] = 4
MODIFIED_CCC[91] = 5
MODIFIED_CCC[103] = 3
MODIFIED_CCC[130] = 132
MODIFIED_CCC[132] = 131

/** Modified combining class of a code point (see MODIFIED_CCC). */
export function getModifiedCombiningClass(cp: number): number {
  // Reorder SAKOT to come after any tone marks.
  if (cp === 0x1A60) return 254
  // Reorder PADMA to come after any vowel marks.
  if (cp === 0x0FC6) return 254
  // Reorder TSA -PHRU to come before U+0F74.
  if (cp === 0x0F39) return 127
  return MODIFIED_CCC[getCombiningClass(cp)]!
}

/**
 * Reorder every maximal run of combining marks (modified ccc != 0) into
 * ascending modified-ccc order with a stable in-place insertion sort. The
 * clusters array (per-code-point source counts) moves with the code points.
 */
export function reorderMarkRuns(cps: number[], clusters: number[], sourceClusters?: number[]): void {
  const n = cps.length
  let i = 0
  while (i < n) {
    if (getModifiedCombiningClass(cps[i]!) === 0) {
      i++
      continue
    }
    let end = i + 1
    while (end < n && getModifiedCombiningClass(cps[end]!) !== 0) end++
    if (end - i > 1) {
      for (let j = i + 1; j < end; j++) {
        const cp = cps[j]!
        const cl = clusters[j]!
        const sourceCluster = sourceClusters?.[j]
        const ccc = getModifiedCombiningClass(cp)
        let k = j - 1
        while (k >= i && getModifiedCombiningClass(cps[k]!) > ccc) {
          cps[k + 1] = cps[k]!
          clusters[k + 1] = clusters[k]!
          if (sourceClusters !== undefined) sourceClusters[k + 1] = sourceClusters[k]!
          k--
        }
        cps[k + 1] = cp
        clusters[k + 1] = cl
        if (sourceClusters !== undefined) sourceClusters[k + 1] = sourceCluster!
      }
    }
    i = end
  }
}

const DECOMP_COUNT = INDIC_DECOMP.length / 3

/**
 * Canonical decomposition of an Indic code point (U+0900..0DFF).
 * @returns [first, second] (second = 0 for singletons) or null
 */
export function getIndicDecomposition(cp: number): [number, number] | null {
  let lo = 0
  let hi = DECOMP_COUNT - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const base = mid * 3
    if (cp < INDIC_DECOMP[base]!) {
      hi = mid - 1
    } else if (cp > INDIC_DECOMP[base]!) {
      lo = mid + 1
    } else {
      return [INDIC_DECOMP[base + 1]!, INDIC_DECOMP[base + 2]! & 0xFFFFFF]
    }
  }
  return null
}

/**
 * Canonical composition of an Indic pair (reverse of getIndicDecomposition,
 * honoring composition exclusions).
 * @returns the composed code point or 0
 */
export function composeIndicPair(a: number, b: number): number {
  for (let i = 0; i < DECOMP_COUNT; i++) {
    const base = i * 3
    const second = INDIC_DECOMP[base + 2]!
    if ((second & 0xFFFFFF) === b && INDIC_DECOMP[base + 1] === a && b !== 0) {
      if ((second & 0x1000000) !== 0) return 0 // composition exclusion
      return INDIC_DECOMP[base]!
    }
  }
  return 0
}
