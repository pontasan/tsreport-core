import { getCombiningClass } from '../shaping/normalize.js'
import {
  NORMALIZATION_COMPOSITIONS,
  NORMALIZATION_DECOMPOSITION_COMPATIBILITY,
  NORMALIZATION_DECOMPOSITION_KEYS,
  NORMALIZATION_DECOMPOSITION_OFFSETS,
  NORMALIZATION_DECOMPOSITION_VALUES,
} from './unicode-normalization-data.js'

export type UnicodeNormalizationForm = 'NFC' | 'NFD' | 'NFKC' | 'NFKD'

export function normalizeUnicodeText(text: string, form: UnicodeNormalizationForm): string {
  const compatibility = form === 'NFKC' || form === 'NFKD'
  const composed = form === 'NFC' || form === 'NFKC'
  const codePoints: number[] = []
  for (const character of text) decomposeCodePoint(character.codePointAt(0)!, compatibility, codePoints)
  canonicalOrder(codePoints)
  return String.fromCodePoint(...(composed ? composeCodePoints(codePoints) : codePoints))
}

const S_BASE = 0xAC00
const L_BASE = 0x1100
const V_BASE = 0x1161
const T_BASE = 0x11A7
const L_COUNT = 19
const V_COUNT = 21
const T_COUNT = 28
const N_COUNT = V_COUNT * T_COUNT
const S_COUNT = L_COUNT * N_COUNT

function decomposeCodePoint(codePoint: number, compatibility: boolean, result: number[]): void {
  const syllableIndex = codePoint - S_BASE
  if (syllableIndex >= 0 && syllableIndex < S_COUNT) {
    result.push(L_BASE + Math.floor(syllableIndex / N_COUNT))
    result.push(V_BASE + Math.floor((syllableIndex % N_COUNT) / T_COUNT))
    const trail = syllableIndex % T_COUNT
    if (trail !== 0) result.push(T_BASE + trail)
    return
  }
  const index = binarySearch(NORMALIZATION_DECOMPOSITION_KEYS, codePoint)
  if (index < 0 || (!compatibility && NORMALIZATION_DECOMPOSITION_COMPATIBILITY[index] === 1)) {
    result.push(codePoint)
    return
  }
  const start = NORMALIZATION_DECOMPOSITION_OFFSETS[index]!
  const end = NORMALIZATION_DECOMPOSITION_OFFSETS[index + 1]!
  for (let i = start; i < end; i++) {
    decomposeCodePoint(NORMALIZATION_DECOMPOSITION_VALUES[i]!, compatibility, result)
  }
}

function canonicalOrder(codePoints: number[]): void {
  for (let i = 1; i < codePoints.length; i++) {
    const combiningClass = getCombiningClass(codePoints[i]!)
    if (combiningClass === 0) continue
    let position = i
    while (position > 0) {
      const previousClass = getCombiningClass(codePoints[position - 1]!)
      if (previousClass === 0 || previousClass <= combiningClass) break
      const previous = codePoints[position - 1]!
      codePoints[position - 1] = codePoints[position]!
      codePoints[position] = previous
      position--
    }
  }
}

function composeCodePoints(decomposed: readonly number[]): number[] {
  if (decomposed.length === 0) return []
  const result = [decomposed[0]!]
  let starterPosition = 0
  let starter = result[0]!
  let lastCombiningClass = getCombiningClass(starter)
  for (let i = 1; i < decomposed.length; i++) {
    const codePoint = decomposed[i]!
    const combiningClass = getCombiningClass(codePoint)
    const composite = composePair(starter, codePoint)
    if (composite >= 0 && (lastCombiningClass === 0 || lastCombiningClass < combiningClass)) {
      result[starterPosition] = composite
      starter = composite
      continue
    }
    if (combiningClass === 0) {
      starterPosition = result.length
      starter = codePoint
    }
    result.push(codePoint)
    lastCombiningClass = combiningClass
  }
  return result
}

function composePair(first: number, second: number): number {
  const leadingIndex = first - L_BASE
  if (leadingIndex >= 0 && leadingIndex < L_COUNT) {
    const vowelIndex = second - V_BASE
    if (vowelIndex >= 0 && vowelIndex < V_COUNT) return S_BASE + (leadingIndex * V_COUNT + vowelIndex) * T_COUNT
  }
  const syllableIndex = first - S_BASE
  if (syllableIndex >= 0 && syllableIndex < S_COUNT && syllableIndex % T_COUNT === 0) {
    const trailIndex = second - T_BASE
    if (trailIndex > 0 && trailIndex < T_COUNT) return first + trailIndex
  }
  let low = 0
  let high = NORMALIZATION_COMPOSITIONS.length / 3 - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const offset = middle * 3
    const currentFirst = NORMALIZATION_COMPOSITIONS[offset]!
    const currentSecond = NORMALIZATION_COMPOSITIONS[offset + 1]!
    if (first < currentFirst || (first === currentFirst && second < currentSecond)) high = middle - 1
    else if (first > currentFirst || second > currentSecond) low = middle + 1
    else return NORMALIZATION_COMPOSITIONS[offset + 2]!
  }
  return -1
}

function binarySearch(values: Uint32Array, target: number): number {
  let low = 0
  let high = values.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const value = values[middle]!
    if (target < value) high = middle - 1
    else if (target > value) low = middle + 1
    else return middle
  }
  return -1
}
