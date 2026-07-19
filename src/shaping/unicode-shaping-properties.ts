import {
  UNICODE_BLOCK_NAMES,
  UNICODE_BLOCK_RANGES,
  UNICODE_INDIC_POSITIONAL_CATEGORY_NAMES,
  UNICODE_INDIC_POSITIONAL_CATEGORY_RANGES,
  UNICODE_INDIC_SYLLABIC_CATEGORY_NAMES,
  UNICODE_INDIC_SYLLABIC_CATEGORY_RANGES,
  UNICODE_JOINING_TYPE_NAMES,
  UNICODE_JOINING_TYPE_RANGES,
  UNICODE_SCRIPT_NAMES,
  UNICODE_SCRIPT_RANGES,
  UNICODE_SCRIPT_TAGS,
} from './unicode-shaping-data.js'

function findRangeValue(codePoint: number, ranges: Uint32Array): number {
  let low = 0
  let high = ranges.length / 3 - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const offset = middle * 3
    if (codePoint < ranges[offset]!) high = middle - 1
    else if (codePoint > ranges[offset + 1]!) low = middle + 1
    else return ranges[offset + 2]!
  }
  return -1
}

/** Unicode 17.0 Script property, with the normative Unknown default. */
export function getUnicodeScript(codePoint: number): string {
  const value = findRangeValue(codePoint, UNICODE_SCRIPT_RANGES)
  return value < 0 ? 'Unknown' : UNICODE_SCRIPT_NAMES[value]!
}

/** ISO 15924 script tag associated with the Unicode Script property. */
export function getUnicodeScriptTag(codePoint: number): string {
  const value = findRangeValue(codePoint, UNICODE_SCRIPT_RANGES)
  return value < 0 ? 'Zzzz' : UNICODE_SCRIPT_TAGS[value]!
}

/** Unicode 17.0 block name, or null for code points outside a named block. */
export function getUnicodeBlock(codePoint: number): string | null {
  const value = findRangeValue(codePoint, UNICODE_BLOCK_RANGES)
  return value < 0 ? null : UNICODE_BLOCK_NAMES[value]!
}

/** Unicode 17.0 Joining_Type, with the normative Non_Joining default. */
export function getUnicodeJoiningType(codePoint: number): 'U' | 'T' | 'C' | 'D' | 'R' | 'L' {
  const value = findRangeValue(codePoint, UNICODE_JOINING_TYPE_RANGES)
  return value < 0 ? 'U' : UNICODE_JOINING_TYPE_NAMES[value]!
}

/** Unicode 17.0 Indic_Syllabic_Category, with the normative Other default. */
export function getUnicodeIndicSyllabicCategory(codePoint: number): string {
  const value = findRangeValue(codePoint, UNICODE_INDIC_SYLLABIC_CATEGORY_RANGES)
  return value < 0 ? 'Other' : UNICODE_INDIC_SYLLABIC_CATEGORY_NAMES[value]!
}

/** Unicode 17.0 Indic_Positional_Category, with the normative Not_Applicable default. */
export function getUnicodeIndicPositionalCategory(codePoint: number): string {
  const value = findRangeValue(codePoint, UNICODE_INDIC_POSITIONAL_CATEGORY_RANGES)
  return value < 0 ? 'Not_Applicable' : UNICODE_INDIC_POSITIONAL_CATEGORY_NAMES[value]!
}
