/**
 * Shaping category and position constants shared by the complex-script
 * shapers (Indic, Khmer, Myanmar). The numeric values match the packing used
 * by the generated classification table (unicode-tables.ts INDIC_RANGES) and
 * must not be changed independently of the generator.
 */

import { INDIC_RANGES } from './unicode-tables.js'
import {
  getUnicodeIndicPositionalCategory,
  getUnicodeIndicSyllabicCategory,
  getUnicodeScript,
} from './unicode-shaping-properties.js'

// --- Categories (low byte of the packed classification value) ---

export const CAT_X = 0
export const CAT_C = 1
export const CAT_V = 2 // also Myanmar IV (independent vowel)
export const CAT_N = 3 // also Myanmar DB (dot below)
export const CAT_H = 4 // halant / virama / invisible stacker (Khmer coeng)
export const CAT_ZWNJ = 5
export const CAT_ZWJ = 6
export const CAT_M = 7
export const CAT_SM = 8
export const CAT_A = 9 // also VD (vedic)
export const CAT_PLACEHOLDER = 10 // also Myanmar GB
export const CAT_DOTTEDCIRCLE = 11
export const CAT_RS = 12
export const CAT_MPst = 13
export const CAT_Repha = 14
export const CAT_Ra = 15
export const CAT_CM = 16
export const CAT_Symbol = 17
export const CAT_CS = 18
export const CAT_VAbv = 20
export const CAT_VBlw = 21
export const CAT_VPre = 22
export const CAT_VPst = 23
export const CAT_Robatic = 25
export const CAT_Xgroup = 26
export const CAT_Ygroup = 27
export const CAT_As = 32 // Myanmar asat
export const CAT_MH = 35 // Myanmar medial ha
export const CAT_MR = 36 // Myanmar medial ra
export const CAT_MW = 37 // Myanmar medial wa
export const CAT_MY = 38 // Myanmar medial ya
export const CAT_PT = 39 // Myanmar pwo tones
export const CAT_VS = 40 // variation selectors (Myanmar grammar)
export const CAT_ML = 41 // Myanmar medial la
export const CAT_SMPst = 57

// --- Visual positions in a syllable, left to right (high byte) ---

export const POS_START = 0
export const POS_RA_TO_BECOME_REPH = 1
export const POS_PRE_M = 2
export const POS_PRE_C = 3
export const POS_BASE_C = 4
export const POS_AFTER_MAIN = 5
export const POS_ABOVE_C = 6
export const POS_BEFORE_SUB = 7
export const POS_BELOW_C = 8
export const POS_AFTER_SUB = 9
export const POS_BEFORE_POST = 10
export const POS_POST_C = 11
export const POS_AFTER_POST = 12
export const POS_SMVD = 13
export const POS_END = 14

/** Default classification for unlisted code points: (X, END). */
export const OT_DEFAULT = CAT_X | (POS_END << 8)

const RANGE_COUNT = INDIC_RANGES.length / 3

/**
 * Look up the packed (category | position << 8) classification of a code
 * point (binary search over the generated ranges).
 */
export function getShapingClass(cp: number): number {
  let lo = 0
  let hi = RANGE_COUNT - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const base = mid * 3
    if (cp < INDIC_RANGES[base]!) {
      hi = mid - 1
    } else if (cp > INDIC_RANGES[base + 1]!) {
      lo = mid + 1
    } else {
      return INDIC_RANGES[base + 2]!
    }
  }
  return deriveShapingClass(cp)
}

function deriveShapingClass(cp: number): number {
  const syllabic = getUnicodeIndicSyllabicCategory(cp)
  let category = CAT_X
  switch (syllabic) {
    case 'Bindu':
    case 'Gemination_Mark':
    case 'Syllable_Modifier':
    case 'Visarga': category = CAT_SM; break
    case 'Cantillation_Mark': category = CAT_A; break
    case 'Consonant':
    case 'Consonant_Dead':
    case 'Consonant_Head_Letter': category = CAT_C; break
    case 'Consonant_Final':
    case 'Consonant_Medial':
    case 'Consonant_Subjoined':
    case 'Consonant_Succeeding_Repha': category = CAT_CM; break
    case 'Consonant_Placeholder':
    case 'Number':
    case 'Number_Joiner':
    case 'Brahmi_Joining_Number': category = CAT_PLACEHOLDER; break
    case 'Consonant_Preceding_Repha': category = CAT_Repha; break
    case 'Consonant_With_Stacker': category = CAT_CS; break
    case 'Invisible_Stacker':
    case 'Virama': category = CAT_H; break
    case 'Joiner': category = CAT_ZWJ; break
    case 'Non_Joiner': category = CAT_ZWNJ; break
    case 'Nukta':
    case 'Tone_Mark': category = CAT_N; break
    case 'Register_Shifter': category = CAT_RS; break
    case 'Avagraha': category = CAT_Symbol; break
    case 'Consonant_Killer':
    case 'Pure_Killer':
    case 'Vowel_Dependent': category = CAT_M; break
    case 'Vowel':
    case 'Vowel_Independent': category = CAT_V; break
  }

  let position = POS_END
  switch (getUnicodeIndicPositionalCategory(cp)) {
    case 'Left':
    case 'Visual_Order_Left': position = POS_PRE_M; break
    case 'Top':
    case 'Top_And_Left': position = POS_ABOVE_C; break
    case 'Bottom':
    case 'Top_And_Bottom':
    case 'Top_And_Bottom_And_Left': position = POS_BELOW_C; break
    case 'Overstruck': position = POS_AFTER_MAIN; break
    case 'Right':
    case 'Bottom_And_Right':
    case 'Left_And_Right':
    case 'Top_And_Bottom_And_Right':
    case 'Top_And_Left_And_Right':
    case 'Top_And_Right': position = POS_POST_C; break
  }

  if (getUnicodeScript(cp) === 'Sinhala') {
    if (category === CAT_SM) position = POS_SMVD
    else if (category === CAT_C || category === CAT_V) position = POS_BASE_C
    else if (category === CAT_H) position = POS_BELOW_C
    else if (category === CAT_M && position !== POS_PRE_M) position = POS_AFTER_SUB
  }
  return category | (position << 8)
}
