/**
 * Unicode extended grapheme cluster boundaries (UAX #29).
 */

import {
  EXTENDED_PICTOGRAPHIC_RANGES,
  GRAPHEME_BREAK_RANGES,
  INDIC_CONJUNCT_BREAK_RANGES,
} from './grapheme-break-data.js'

const enum GCB {
  Other,
  CR,
  LF,
  Control,
  Extend,
  ZWJ,
  RegionalIndicator,
  Prepend,
  SpacingMark,
  L,
  V,
  T,
  LV,
  LVT,
}

const enum InCB {
  None,
  Linker,
  Consonant,
  Extend,
}

/** Returns true when UAX #29 permits a grapheme cluster boundary at breakIndex. */
export function canBreakGraphemeAt(chars: readonly string[], breakIndex: number): boolean {
  if (breakIndex <= 0 || breakIndex >= chars.length) return true

  const leftCp = chars[breakIndex - 1]!.codePointAt(0)!
  const rightCp = chars[breakIndex]!.codePointAt(0)!
  const left = graphemeBreakClass(leftCp)
  const right = graphemeBreakClass(rightCp)

  // GB3-GB5
  if (left === GCB.CR && right === GCB.LF) return false
  if (left === GCB.CR || left === GCB.LF || left === GCB.Control) return true
  if (right === GCB.CR || right === GCB.LF || right === GCB.Control) return true

  // GB6-GB8
  if (left === GCB.L && (right === GCB.L || right === GCB.V || right === GCB.LV || right === GCB.LVT)) return false
  if ((left === GCB.LV || left === GCB.V) && (right === GCB.V || right === GCB.T)) return false
  if ((left === GCB.LVT || left === GCB.T) && right === GCB.T) return false

  // GB9-GB9b
  if (right === GCB.Extend || right === GCB.ZWJ) return false
  if (right === GCB.SpacingMark) return false
  if (left === GCB.Prepend) return false

  // GB9c
  if (indicConjunctBreak(rightCp) === InCB.Consonant && hasIndicConjunctBefore(chars, breakIndex)) return false

  // GB11
  if (isExtendedPictographic(rightCp) && hasExtendedPictographicZwJBefore(chars, breakIndex)) return false

  // GB12/GB13
  if (left === GCB.RegionalIndicator && right === GCB.RegionalIndicator && regionalIndicatorRunLength(chars, breakIndex) % 2 === 1) return false

  return true
}

export function graphemeBreaks(text: string): number[] {
  const chars = [...text]
  const breaks: number[] = [0]
  for (let i = 1; i < chars.length; i++) {
    if (canBreakGraphemeAt(chars, i)) breaks.push(i)
  }
  breaks.push(chars.length)
  return breaks
}

export function graphemeClusters(text: string): string[] {
  const chars = [...text]
  if (chars.length === 0) return []
  const clusters: string[] = []
  let start = 0
  for (let i = 1; i < chars.length; i++) {
    if (!canBreakGraphemeAt(chars, i)) continue
    clusters.push(chars.slice(start, i).join(''))
    start = i
  }
  clusters.push(chars.slice(start).join(''))
  return clusters
}

export function buildGraphemeBoundaryFlags(chars: readonly string[]): Uint8Array {
  const flags = new Uint8Array(chars.length + 1)
  flags[0] = 1
  flags[chars.length] = 1
  for (let i = 1; i < chars.length; i++) {
    if (canBreakGraphemeAt(chars, i)) flags[i] = 1
  }
  return flags
}

function hasIndicConjunctBefore(chars: readonly string[], breakIndex: number): boolean {
  let sawLinker = false
  for (let i = breakIndex - 1; i >= 0; i--) {
    const value = indicConjunctBreak(chars[i]!.codePointAt(0)!)
    if (value === InCB.Linker) {
      sawLinker = true
      continue
    }
    if (value === InCB.Extend) continue
    return value === InCB.Consonant && sawLinker
  }
  return false
}

function hasExtendedPictographicZwJBefore(chars: readonly string[], breakIndex: number): boolean {
  if (graphemeBreakClass(chars[breakIndex - 1]!.codePointAt(0)!) !== GCB.ZWJ) return false
  for (let i = breakIndex - 2; i >= 0; i--) {
    const cp = chars[i]!.codePointAt(0)!
    if (graphemeBreakClass(cp) === GCB.Extend) continue
    return isExtendedPictographic(cp)
  }
  return false
}

function regionalIndicatorRunLength(chars: readonly string[], breakIndex: number): number {
  let count = 0
  for (let i = breakIndex - 1; i >= 0; i--) {
    if (graphemeBreakClass(chars[i]!.codePointAt(0)!) !== GCB.RegionalIndicator) break
    count++
  }
  return count
}

function graphemeBreakClass(cp: number): GCB {
  return lookupRangeValue(GRAPHEME_BREAK_RANGES, cp) as GCB
}

function indicConjunctBreak(cp: number): InCB {
  return lookupRangeValue(INDIC_CONJUNCT_BREAK_RANGES, cp) as InCB
}

function isExtendedPictographic(cp: number): boolean {
  let lo = 0
  let hi = EXTENDED_PICTOGRAPHIC_RANGES.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const range = EXTENDED_PICTOGRAPHIC_RANGES[mid]!
    if (cp < range[0]) hi = mid - 1
    else if (cp > range[1]) lo = mid + 1
    else return true
  }
  return false
}

function lookupRangeValue(ranges: readonly (readonly [number, number, number])[], cp: number): number {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const range = ranges[mid]!
    if (cp < range[0]) hi = mid - 1
    else if (cp > range[1]) lo = mid + 1
    else return range[2]
  }
  return 0
}
