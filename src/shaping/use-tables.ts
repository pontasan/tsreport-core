/**
 * USE (Universal Shaping Engine) character classification.
 *
 * Categories follow the Microsoft USE specification / HarfBuzz's use table:
 * each entry maps a code point range to a USE class. Scripts covered by the
 * dedicated shapers (Indic, Khmer, Myanmar, Tibetan, Hangul) are NOT listed
 * here — this table serves the USE-shaped scripts.
 */

import { getUnicodeScript, getUnicodeScriptTag } from './unicode-shaping-properties.js'
import { UNICODE_USE_SHAPING_RANGES } from './unicode-shaping-data.js'

// --- USE categories ---

export const U_O = 0        // other / non-cluster content
export const U_B = 1        // base
export const U_N = 2        // number base
export const U_GB = 3       // generic base (placeholder)
export const U_SUB = 4      // subjoined consonant
export const U_H = 5        // halant / virama (visible)
export const U_HN = 6       // halant-number joiner
export const U_ZWNJ = 7
export const U_ZWJ = 8
export const U_CGJ = 9
export const U_VS = 10      // variation selector
export const U_R = 11       // repha
export const U_CS = 12      // consonant with stacker
export const U_HVM = 13     // halant-or-vowel-modifier
export const U_SK = 14      // sakot
export const U_IS = 15      // invisible stacker
export const U_IND = 16     // independent
export const U_S = 17       // symbol
export const U_WJ = 18      // word joiner
export const U_FABV = 20
export const U_FBLW = 21
export const U_FPST = 22
export const U_MABV = 23
export const U_MBLW = 24
export const U_MPST = 25
export const U_MPRE = 26
export const U_CMABV = 27
export const U_CMBLW = 28
export const U_VABV = 29
export const U_VBLW = 30
export const U_VPST = 31
export const U_VPRE = 32
export const U_VMABV = 33
export const U_VMBLW = 34
export const U_VMPST = 35
export const U_VMPRE = 36
export const U_SMABV = 37
export const U_SMBLW = 38
export const U_FMABV = 39
export const U_FMBLW = 40
export const U_FMPST = 41
export const U_DC = 42      // dotted circle (inserted)
export const U_RK = 43      // reordering killer
export const U_G = 44       // hieroglyph
export const U_J = 45       // hieroglyph joiner
export const U_SB = 46      // hieroglyph segment begin
export const U_SE = 47      // hieroglyph segment end
export const U_HM = 48      // hieroglyph modifier
export const U_HR = 49      // hieroglyph mirror

const RANGE_COUNT = UNICODE_USE_SHAPING_RANGES.length / 3

/** USE class of a code point (binary search; O for unlisted). */
export function getUseClass(cp: number): number {
  let lo = 0
  let hi = RANGE_COUNT - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const base = mid * 3
    if (cp < UNICODE_USE_SHAPING_RANGES[base]!) {
      hi = mid - 1
    } else if (cp > UNICODE_USE_SHAPING_RANGES[base + 1]!) {
      lo = mid + 1
    } else {
      return UNICODE_USE_SHAPING_RANGES[base + 2]!
    }
  }
  return U_O
}

const USE_SCRIPTS = new Set<string>([
  'Tibetan', 'Mongolian', 'Sinhala', 'Buhid', 'Hanunoo', 'Tagalog', 'Tagbanwa',
  'Limbu', 'Tai_Le', 'Buginese', 'Kharoshthi', 'Syloti_Nagri', 'Tifinagh',
  'Balinese', 'Phags_Pa', 'Cham', 'Kayah_Li', 'Lepcha', 'Rejang',
  'Saurashtra', 'Sundanese', 'Egyptian_Hieroglyphs', 'Javanese', 'Kaithi',
  'Meetei_Mayek', 'Tai_Tham', 'Tai_Viet', 'Batak', 'Brahmi',
  'Chakma', 'Miao', 'Sharada', 'Takri', 'Duployan', 'Grantha', 'Khojki',
  'Khudawadi', 'Mahajani', 'Manichaean', 'Modi', 'Pahawh_Hmong',
  'Psalter_Pahlavi', 'Siddham', 'Tirhuta', 'Ahom', 'Multani', 'Adlam',
  'Bhaiksuki', 'Marchen', 'Newa', 'Masaram_Gondi', 'Soyombo',
  'Zanabazar_Square', 'Dogra', 'Gunjala_Gondi', 'Hanifi_Rohingya', 'Makasar',
  'Medefaidrin', 'Old_Sogdian', 'Sogdian', 'Elymaic', 'Nandinagari',
  'Nyiakeng_Puachue_Hmong', 'Wancho', 'Chorasmian', 'Dives_Akuru',
  'Khitan_Small_Script', 'Yezidi', 'Cypro_Minoan', 'Old_Uyghur', 'Tangsa',
  'Toto', 'Vithkuqi', 'Kawi', 'Nag_Mundari', 'Garay', 'Gurung_Khema',
  'Kirat_Rai', 'Ol_Onal', 'Sunuwar', 'Todhri', 'Tulu_Tigalari', 'Beria_Erfe',
  'Sidetic', 'Tai_Yo', 'Tolong_Siki',
])

/** Whether the code point belongs to a script assigned to the Universal Shaping Engine. */
export function isUseScriptChar(cp: number): boolean {
  return USE_SCRIPTS.has(getUnicodeScript(cp))
}

/** OpenType script tag for a USE-shaped code point. */
export function deriveUseScriptTag(cp: number): string | null {
  if (!isUseScriptChar(cp)) return null
  const tag = getUnicodeScriptTag(cp).toLowerCase()
  return tag === 'nkoo' ? 'nko ' : tag
}
