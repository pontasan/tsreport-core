/**
 * Thai / Lao shaping preprocessing.
 *
 * Thai and Lao need no syllable analysis or glyph reordering beyond the mark
 * normalization, with one exception: SARA AM (U+0E33 / U+0EB3) is a visual
 * composite of NIKHAHIT (U+0E4D / U+0ECD) and SARA AA (U+0E32 / U+0EB2).
 * Shaping engines decompose it and move the nikhahit backwards over any
 * preceding above-base marks so that tone marks visually stack above the
 * nikhahit: <NO NU, MAI THO, SARA AM> becomes <NO NU, NIKHAHIT, MAI THO,
 * SARA AA>. Below-mark ordering (sara u/uu before phinthu) is handled by the
 * modified combining classes in normalize.ts.
 */

/** Whether the code point is Thai/Lao SARA AM. */
export function isSaraAm(cp: number): boolean {
  return (cp & ~0x0080) === 0x0E33
}

// ─── Thai PUA fallback shaping (HarfBuzz preprocess_text_thai) ───
//
// Legacy Thai fonts (e.g. Arial Unicode) encode pre-positioned tone marks and
// below-vowels in the Private Use Area. When the font has no Thai GSUB script,
// HarfBuzz shifts each combining mark to the appropriate PUA form via two state
// machines (above-base and below-base clusters). This mirrors that fallback so
// such fonts render the same as they do in HarfBuzz.

// Consonant class: 0=NC (normal), 1=AC (ascender), 2=RC (removable descender),
// 3=DC (strict descender), 4=NOT_CONSONANT.
function thaiConsonantType(u: number): number {
  if (u === 0x0E1B || u === 0x0E1D || u === 0x0E1F) return 1 // AC
  if (u === 0x0E0D || u === 0x0E10) return 2 // RC
  if (u === 0x0E0E || u === 0x0E0F) return 3 // DC
  if (u >= 0x0E01 && u <= 0x0E2E) return 0 // NC
  return 4 // NOT_CONSONANT
}

// Mark class: 0=AV (above vowel), 1=BV (below vowel), 2=T (tone), 3=NOT_MARK.
function thaiMarkType(u: number): number {
  if (u === 0x0E31 || (u >= 0x0E34 && u <= 0x0E37) || u === 0x0E47 || (u >= 0x0E4D && u <= 0x0E4E)) return 0 // AV
  if (u >= 0x0E38 && u <= 0x0E3A) return 1 // BV
  if (u >= 0x0E48 && u <= 0x0E4C) return 2 // T
  return 3 // NOT_MARK
}

// Actions: 0=NOP, 1=SD (shift down), 2=SL (shift left), 3=SDL (down-left),
// 4=RD (remove descender from base).
const THAI_ABOVE_START = [0, 1, 0, 0, 3] // per consonant type → above state (T0..T3)
const THAI_BELOW_START = [0, 0, 1, 2, 2] // per consonant type → below state (B0..B2)
// [state][markType] → [action, nextState]
const THAI_ABOVE_SM: [number, number][][] = [
  [[0, 3], [0, 0], [1, 3]], // T0
  [[2, 2], [0, 1], [3, 2]], // T1
  [[0, 3], [0, 2], [2, 3]], // T2
  [[0, 3], [0, 3], [0, 3]], // T3
]
const THAI_BELOW_SM: [number, number][][] = [
  [[0, 0], [0, 2], [0, 0]], // B0
  [[0, 1], [4, 2], [0, 1]], // B1
  [[0, 2], [1, 2], [0, 2]], // B2
]

// PUA mappings per action: u → [winPua, macPua]. Action index 1=SD, 2=SL, 3=SDL, 4=RD.
const THAI_PUA: Record<number, Record<number, [number, number]>> = {
  1: { // SD
    0x0E48: [0xF70A, 0xF88B], 0x0E49: [0xF70B, 0xF88E], 0x0E4A: [0xF70C, 0xF891],
    0x0E4B: [0xF70D, 0xF894], 0x0E4C: [0xF70E, 0xF897], 0x0E38: [0xF718, 0xF89B],
    0x0E39: [0xF719, 0xF89C], 0x0E3A: [0xF71A, 0xF89D],
  },
  3: { // SDL
    0x0E48: [0xF705, 0xF88C], 0x0E49: [0xF706, 0xF88F], 0x0E4A: [0xF707, 0xF892],
    0x0E4B: [0xF708, 0xF895], 0x0E4C: [0xF709, 0xF898],
  },
  2: { // SL
    0x0E48: [0xF713, 0xF88A], 0x0E49: [0xF714, 0xF88D], 0x0E4A: [0xF715, 0xF890],
    0x0E4B: [0xF716, 0xF893], 0x0E4C: [0xF717, 0xF896], 0x0E31: [0xF710, 0xF884],
    0x0E34: [0xF701, 0xF885], 0x0E35: [0xF702, 0xF886], 0x0E36: [0xF703, 0xF887],
    0x0E37: [0xF704, 0xF888], 0x0E47: [0xF712, 0xF889], 0x0E4D: [0xF711, 0xF899],
  },
  4: { // RD
    0x0E0D: [0xF70F, 0xF89A], 0x0E10: [0xF700, 0xF89E],
  },
}

/**
 * Apply Thai PUA fallback shaping in place: replace combining marks (and, for
 * the remove-descender action, the base consonant) with their pre-positioned
 * PUA forms when the font supplies them. `hasGlyph(cp)` reports whether the
 * font maps a code point to a non-.notdef glyph. Called only for Thai runs in a
 * font without a Thai GSUB script (HarfBuzz's found_script fallback).
 */
export function thaiPuaShaping(cps: number[], hasGlyph: (cp: number) => boolean): void {
  let aboveState = THAI_ABOVE_START[4]!
  let belowState = THAI_BELOW_START[4]!
  let base = 0
  for (let i = 0; i < cps.length; i++) {
    const mt = thaiMarkType(cps[i]!)
    if (mt === 3) {
      const ct = thaiConsonantType(cps[i]!)
      aboveState = THAI_ABOVE_START[ct]!
      belowState = THAI_BELOW_START[ct]!
      base = i
      continue
    }
    const aboveEdge = THAI_ABOVE_SM[aboveState]![mt]!
    const belowEdge = THAI_BELOW_SM[belowState]![mt]!
    aboveState = aboveEdge[1]
    belowState = belowEdge[1]
    // At least one of the above/below actions is NOP.
    const action = aboveEdge[0] !== 0 ? aboveEdge[0] : belowEdge[0]
    if (action === 0) continue
    const target = action === 4 ? base : i
    const mapping = THAI_PUA[action]?.[cps[target]!]
    if (mapping === undefined) continue
    if (hasGlyph(mapping[0])) cps[target] = mapping[0]
    else if (hasGlyph(mapping[1])) cps[target] = mapping[1]
  }
}

/**
 * Whether the code point is a Thai/Lao above-base mark the nikhahit must move
 * over (Thai: U+0E31, U+0E34..0E37, U+0E3B, U+0E47..0E4E; Lao at +0x80).
 */
function isAboveBaseMark(cp: number): boolean {
  const x = cp & ~0x0080
  return (x >= 0x0E34 && x <= 0x0E37)
    || (x >= 0x0E47 && x <= 0x0E4E)
    || x === 0x0E31
    || x === 0x0E3B
}

/**
 * Decompose SARA AM into NIKHAHIT + SARA AA in place, moving the nikhahit
 * backwards over preceding above-base marks. The clusters array moves with
 * the code points; the nikhahit takes the source count of the sara am and
 * the sara aa becomes a continuation (count 0).
 * Arrays are modified in place (length grows by one per sara am).
 */
export function preprocessThaiLao(cps: number[], clusters: number[], sourceClusters?: number[]): void {
  for (let i = 0; i < cps.length; i++) {
    const u = cps[i]!
    if (!isSaraAm(u)) continue

    const nikhahit = u - 0x0E33 + 0x0E4D
    const saraAa = u - 1
    // Replace sara am with nikhahit + sara aa.
    cps.splice(i, 1, nikhahit, saraAa)
    clusters.splice(i, 1, clusters[i]!, 0)
    if (sourceClusters !== undefined) sourceClusters.splice(i, 1, sourceClusters[i]!, sourceClusters[i]!)

    // Move the nikhahit backwards over the run of above-base marks.
    let start = i
    while (start > 0 && isAboveBaseMark(cps[start - 1]!)) start--
    if (start < i) {
      // Merge the source counts of the covered range onto its first slot so
      // the per-code-point counts keep summing to the source count
      // regardless of the new order.
      let sum = 0
      for (let j = start; j <= i + 1; j++) {
        sum += clusters[j]!
        clusters[j] = 0
      }
      clusters[start] = sum
      for (let j = i; j > start; j--) {
        cps[j] = cps[j - 1]!
        if (sourceClusters !== undefined) sourceClusters[j] = sourceClusters[j - 1]!
      }
      cps[start] = nikhahit
      if (sourceClusters !== undefined) {
        let source = sourceClusters[start]!
        for (let j = start + 1; j <= i + 1; j++) {
          if (sourceClusters[j]! < source) source = sourceClusters[j]!
        }
        for (let j = start; j <= i + 1; j++) sourceClusters[j] = source
      }
    }
    i++ // Skip the sara aa.
  }
}
