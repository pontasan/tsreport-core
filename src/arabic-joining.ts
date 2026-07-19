/**
 * Cursive joining analysis (Unicode Standard chapter 9.2 / ArabicShaping.txt).
 *
 * Determines the joining position (isolated / initial / medial / final) of each
 * code point so that the corresponding OpenType positional features
 * (isol / init / medi / fina) can be applied selectively during shaping.
 */

import { getUnicodeJoiningType } from './shaping/unicode-shaping-properties.js'

// ─── Joining_Type property values ───

const JT_U = 0 // Non_Joining
const JT_T = 1 // Transparent (combining marks, format controls: skipped by joining)
const JT_C = 2 // Join_Causing (tatweel, ZWJ)
const JT_D = 3 // Dual_Joining
const JT_R = 4 // Right_Joining
const JT_L = 5 // Left_Joining

// ─── Joining position values (output of computeJoiningPositions) ───

/** No positional feature applies (non-joining scripts, marks, controls) */
export const JOIN_POS_NONE = 0
/** Isolated form (isol) */
export const JOIN_POS_ISOL = 1
/** Final form (fina) */
export const JOIN_POS_FINA = 2
/** Medial form (medi) */
export const JOIN_POS_MEDI = 3
/** Initial form (init) */
export const JOIN_POS_INIT = 4

/** Look up the Joining_Type of a code point (binary search over the ranges). */
function getJoiningType(cp: number): number {
  switch (getUnicodeJoiningType(cp)) {
    case 'T': return JT_T
    case 'C': return JT_C
    case 'D': return JT_D
    case 'R': return JT_R
    case 'L': return JT_L
    default: return JT_U
  }
}

/**
 * Whether the code point is a joining letter that should activate cursive
 * shaping for a run. Block-based detection includes digits and punctuation;
 * Join_Causing controls such as ZWJ also cannot activate the Arabic path by
 * themselves because they occur in unrelated script runs.
 */
export function isCursiveJoiningChar(cp: number): boolean {
  const type = getJoiningType(cp)
  return type === JT_D || type === JT_R || type === JT_L
}

export const isArabicJoiningChar = isCursiveJoiningChar

/**
 * Compute the joining position of each code point (Unicode cursive joining rules).
 *
 * A character joins on its right side (toward the preceding character in
 * logical order) when it is dual- or right-joining and the nearest preceding
 * non-transparent character joins on its left side (dual-, left- or
 * join-causing). The symmetric rule applies for the left side. Transparent
 * characters (combining marks, format controls) are skipped entirely.
 *
 * @param codePoints Code points in logical order.
 * @returns Per-code-point JOIN_POS_* values (JOIN_POS_NONE for characters
 *          that take no positional feature).
 */
export function computeJoiningPositions(codePoints: number[]): Uint8Array {
  const n = codePoints.length
  const positions = new Uint8Array(n) // initialized to JOIN_POS_NONE
  // Whether the nearest preceding non-transparent character joins on its left side
  let prevJoinsLeft = false
  // Index of the preceding D/L character whose left join is still unresolved
  let pendingIdx = -1

  for (let i = 0; i < n; i++) {
    const t = getJoiningType(codePoints[i]!)
    if (t === JT_T) continue // transparent: invisible to joining analysis

    if (t === JT_U) {
      positions[i] = JOIN_POS_NONE
      prevJoinsLeft = false
      pendingIdx = -1
      continue
    }

    // This character joins on its right side toward the pending character
    // when it is dual-, right- or join-causing: resolve the pending left join.
    if (pendingIdx >= 0 && (t === JT_D || t === JT_R || t === JT_C)) {
      positions[pendingIdx] = positions[pendingIdx] === JOIN_POS_FINA
        ? JOIN_POS_MEDI
        : JOIN_POS_INIT
    }

    if (t === JT_C) {
      // Join-causing characters (tatweel, ZWJ) take no positional form themselves
      positions[i] = JOIN_POS_NONE
      prevJoinsLeft = true
      pendingIdx = -1
      continue
    }

    // D, R or L
    const joinsRight = (t === JT_D || t === JT_R) && prevJoinsLeft
    positions[i] = joinsRight ? JOIN_POS_FINA : JOIN_POS_ISOL
    pendingIdx = (t === JT_D || t === JT_L) ? i : -1
    prevJoinsLeft = t === JT_D || t === JT_L
  }

  return positions
}
