/**
 * Unicode line breaking (UAX #14) boundary classifier.
 *
 * The classifier uses the Line_Break classes needed by the pair-table rules
 * and assigns code points by normative ranges or stable algorithmic ranges
 * where the property is derived from character structure.
 */

import { LINE_BREAK_RANGES } from './line-break-data.js'

const enum LB {
  AI,
  AK,
  AL,
  AP,
  AS,
  BA,
  BB,
  BK,
  B2,
  CB,
  CJ,
  CL,
  CM,
  CP,
  CR,
  EB,
  EM,
  EX,
  GL,
  H2,
  H3,
  HL,
  HY,
  HH,
  ID,
  IN,
  IS,
  JL,
  JT,
  JV,
  LF,
  NL,
  NS,
  NU,
  OP,
  PO,
  PR,
  QU,
  RI,
  SA,
  SG,
  SP,
  SY,
  VF,
  VI,
  WJ,
  XX,
  ZW,
  ZWJ,
}

/** Returns true when a line break is permitted before chars[breakIndex]. */
export function canBreakAt(chars: readonly string[], breakIndex: number): boolean {
  if (breakIndex <= 0 || breakIndex >= chars.length) return false

  const rawLeft = lineBreakClass(chars[breakIndex - 1]!.codePointAt(0)!)
  const rawRight = lineBreakClass(chars[breakIndex]!.codePointAt(0)!)
  const rightCp = chars[breakIndex]!.codePointAt(0)!
  const resolvedLeftBaseIndex = previousNonCombiningIndex(chars, breakIndex - 1)
  const leftBaseIndex = resolvedLeftBaseIndex < 0 ? breakIndex - 1 : resolvedLeftBaseIndex
  const leftCp = chars[leftBaseIndex]!.codePointAt(0)!
  const left = getResolvedClass(chars, breakIndex - 1)
  const right = getResolvedClass(chars, breakIndex)

  // LB4-LB7
  if (left === LB.CR && right === LB.LF) return false
  if (left === LB.BK || left === LB.CR || left === LB.LF || left === LB.NL) return true
  if (right === LB.BK || right === LB.CR || right === LB.LF || right === LB.NL) return false
  if (rawRight === LB.SP || rawRight === LB.ZW) return false

  // LB8, LB8a, LB9-LB12a
  if (previousSignificantClass(chars, breakIndex - 1) === LB.ZW) return true
  if (left === LB.ZWJ) return false
  if ((isCombiningLike(rawRight, rightCp) || rawRight === LB.ZWJ) && !isCombiningSequenceStarter(rawLeft)) return false
  if (left === LB.WJ || right === LB.WJ) return false
  if (left === LB.GL) return false
  if (right === LB.GL && left !== LB.SP && left !== LB.BA && left !== LB.HY && left !== LB.HH) return false

  // LB13-LB18
  if (right === LB.IS && left === LB.SP && nextNonCombiningClass(chars, breakIndex + 1) === LB.NU) return true
  if (right === LB.CL || right === LB.CP || right === LB.EX || right === LB.IS || right === LB.SY) return false
  if (leftOfSpacesAndCombining(chars, breakIndex - 1) === LB.OP) return false
  if (right === LB.QU && isFinalQuotation(rightCp) && isFinalQuotationContext(chars, breakIndex)) return false
  if (right === LB.NS && isClosingClass(leftOfSpacesAndCombining(chars, breakIndex - 1))) return false
  if (left === LB.B2 && right === LB.B2) return false
  if (right === LB.B2 && leftOfSpacesAndCombining(chars, breakIndex - 1) === LB.B2) return false
  const leftQuoteIndex = leftOfSpacesAndCombiningIndex(chars, breakIndex - 1)
  if (lineBreakClass(chars[leftQuoteIndex]!.codePointAt(0)!) === LB.QU &&
      isInitialQuotation(chars[leftQuoteIndex]!.codePointAt(0)!) &&
      isInitialQuotationBlockedAfter(chars, leftQuoteIndex)) return false
  if (left === LB.SP) return true
  if (isArabicBreakAfter(leftCp)) return true
  if ((left === LB.QU || right === LB.QU) && shouldKeepQuotationTogether(chars, breakIndex, left, right, leftCp, rightCp)) return false

  // LB19-LB22
  if (left === LB.CB || right === LB.CB) return true
  if (isWordInitialHyphen(chars, leftBaseIndex, left, right)) return false
  if (right === LB.BA || right === LB.HY || right === LB.HH || right === LB.NS) return false
  if (left === LB.BB) return false
  if (previousNonCombiningClass(chars, leftBaseIndex - 1) === LB.HL && (left === LB.HY || left === LB.HH) && right !== LB.HL) return false
  if (left === LB.SY && isHebrewLetter(right)) return false
  if (right === LB.IN) return false

  // LB23-LB25
  if ((isAlphabeticLetter(left) && right === LB.NU) || (left === LB.NU && isAlphabeticLetter(right))) return false
  if ((left === LB.PR && isIdeographicOrEmoji(right)) || (isIdeographicOrEmoji(left) && right === LB.PO)) return false
  if ((isPrefixPostfix(left) && isAlphabeticLetter(right)) || (isAlphabeticLetter(left) && isPrefixPostfix(right))) return false
  if ((left === LB.PR || left === LB.PO) && right === LB.OP && isNumericAfterOpening(chars, breakIndex + 1)) return false
  if ((left === LB.CL || left === LB.CP) && (right === LB.PR || right === LB.PO) && isNumericBeforeClosing(chars, leftBaseIndex - 1)) return false
  if ((left === LB.IS || left === LB.SY) && (right === LB.PR || right === LB.PO) && previousNonCombiningClass(chars, leftBaseIndex - 1) === LB.NU) return false
  if (isNumericSequencePair(left, right)) return false

  // LB26-LB27
  if (left === LB.JL && (right === LB.JL || right === LB.JV || right === LB.H2 || right === LB.H3)) return false
  if ((left === LB.JV || left === LB.H2) && (right === LB.JV || right === LB.JT)) return false
  if ((left === LB.JT || left === LB.H3) && right === LB.JT) return false
  if (isHangulSyllableClass(left) && right === LB.PO) return false
  if (left === LB.PR && isHangulSyllableClass(right)) return false

  // LB28-LB30b
  if (isAlphabeticLetter(left) && isAlphabeticLetter(right)) return false
  if (left === LB.AP && isAksharaBase(right, rightCp)) return false
  if (isAksharaBase(left, leftCp) && (right === LB.VF || right === LB.VI)) return false
  if (left === LB.VI && isAksharaBase(previousNonCombiningClass(chars, leftBaseIndex - 1), previousNonCombiningCodePoint(chars, leftBaseIndex - 1)) && (right === LB.AK || isDottedCircle(chars[breakIndex]!))) return false
  if (isAksharaBase(left, leftCp) && isAksharaBase(right, rightCp) && nextNonCombiningClass(chars, breakIndex + 1) === LB.VF) return false
  if (left === LB.IS && isAlphabeticLetter(right)) return false
  if (left === LB.SY && right === LB.NU && previousNonCombiningClass(chars, leftBaseIndex - 1) === LB.NU) return false
  if ((isAlphabeticLetter(left) || left === LB.NU) && right === LB.OP && !isEastAsianWidth(chars[breakIndex]!.codePointAt(0)!)) return false
  if (left === LB.CP && !isEastAsianWidth(chars[breakIndex - 1]!.codePointAt(0)!) && (isAlphabeticLetter(right) || right === LB.NU)) return false
  if (left === LB.RI && right === LB.RI && regionalIndicatorRunLength(chars, breakIndex) % 2 === 1) return false
  if ((left === LB.EB || (left !== LB.RI && left !== LB.EM && isExtendedPictographic(leftCp))) && right === LB.EM) return false

  return true
}

/** Returns true when justification may expand the boundary after chars[index]. */
export function isLineBreakJustificationGap(chars: readonly string[], index: number): boolean {
  if (index < 0 || index + 1 >= chars.length) return false
  if (chars[index] === ' ') return true
  const left = getResolvedClass(chars, index)
  const right = getResolvedClass(chars, index + 1)
  if ((left === LB.ID || left === LB.H2 || left === LB.H3) || (right === LB.ID || right === LB.H2 || right === LB.H3)) return true
  return canBreakAt(chars, index + 1) && !isAlphabeticLetter(left) && !isAlphabeticLetter(right) && left !== LB.NU && right !== LB.NU
}

function getResolvedClass(chars: readonly string[], index: number): LB {
  const cp = chars[index]!.codePointAt(0)!
  const cls = lineBreakClass(cp)
  if (cls === LB.AI || cls === LB.SG || cls === LB.XX) return LB.AL
  if (cls === LB.CJ) return LB.NS
  if (cls === LB.SA && !isCombiningMark(cp)) return LB.AL
  if (!isCombiningLike(cls, cp)) return cls
  let i = index - 1
  while (i >= 0) {
    const prevCp = chars[i]!.codePointAt(0)!
    const prev = lineBreakClass(prevCp)
    if (isCombiningSequenceStarter(prev)) return LB.AL
    if (!isCombiningLike(prev, prevCp) && prev !== LB.ZWJ) return resolveClass(prev, prevCp)
    i--
  }
  return LB.AL
}

function resolveClass(cls: LB, cp: number): LB {
  if (cls === LB.AI || cls === LB.SG || cls === LB.XX) return LB.AL
  if (cls === LB.CJ) return LB.NS
  if (cls === LB.SA) return isCombiningMark(cp) ? LB.CM : LB.AL
  return cls
}

function previousSignificantClass(chars: readonly string[], index: number): LB {
  for (let i = index; i >= 0; i--) {
    const cls = lineBreakClass(chars[i]!.codePointAt(0)!)
    if (cls !== LB.SP) return cls
  }
  return LB.AL
}

function leftOfSpacesAndCombining(chars: readonly string[], index: number): LB {
  return getResolvedClass(chars, leftOfSpacesAndCombiningIndex(chars, index))
}

function leftOfSpacesAndCombiningIndex(chars: readonly string[], index: number): number {
  for (let i = index; i >= 0; i--) {
    const cp = chars[i]!.codePointAt(0)!
    const cls = lineBreakClass(cp)
    if (cls === LB.SP || cls === LB.ZWJ || isCombiningLike(cls, cp)) continue
    return i
  }
  return 0
}

function previousNonCombiningIndex(chars: readonly string[], index: number): number {
  for (let i = index; i >= 0; i--) {
    const cp = chars[i]!.codePointAt(0)!
    const cls = lineBreakClass(cp)
    if (cls !== LB.ZWJ && !isCombiningLike(cls, cp)) return i
  }
  return -1
}

function previousNonCombiningClass(chars: readonly string[], index: number): LB {
  for (let i = index; i >= 0; i--) {
    const cp = chars[i]!.codePointAt(0)!
    const cls = lineBreakClass(cp)
    if (cls !== LB.ZWJ && !isCombiningLike(cls, cp)) return resolveClass(cls, cp)
  }
  return LB.AL
}

function previousNonCombiningCodePoint(chars: readonly string[], index: number): number {
  for (let i = index; i >= 0; i--) {
    const cp = chars[i]!.codePointAt(0)!
    const cls = lineBreakClass(cp)
    if (cls !== LB.ZWJ && !isCombiningLike(cls, cp)) return cp
  }
  return 0x0041
}

function nextNonCombiningClass(chars: readonly string[], index: number): LB {
  for (let i = index; i < chars.length; i++) {
    const cp = chars[i]!.codePointAt(0)!
    const cls = lineBreakClass(cp)
    if (cls !== LB.ZWJ && !isCombiningLike(cls, cp)) return resolveClass(cls, cp)
  }
  return LB.AL
}

function nextNonCombiningIndex(chars: readonly string[], index: number): number {
  for (let i = index; i < chars.length; i++) {
    const cp = chars[i]!.codePointAt(0)!
    const cls = lineBreakClass(cp)
    if (cls !== LB.ZWJ && !isCombiningLike(cls, cp)) return i
  }
  return chars.length
}

function regionalIndicatorRunLength(chars: readonly string[], breakIndex: number): number {
  let count = 0
  for (let i = breakIndex - 1; i >= 0; i--) {
    const cp = chars[i]!.codePointAt(0)!
    const cls = lineBreakClass(cp)
    if (cls === LB.CM || cls === LB.ZWJ) continue
    if (cls !== LB.RI) break
    count++
  }
  return count
}

function isAlphabeticLetter(cls: LB): boolean {
  return cls === LB.AL || cls === LB.HL
}

function isHebrewLetter(cls: LB): boolean {
  return cls === LB.HL
}

function isIdeographicOrEmoji(cls: LB): boolean {
  return cls === LB.ID || cls === LB.EB || cls === LB.EM
}

function isAksharaBase(cls: LB, cp: number): boolean {
  return cls === LB.AK || cls === LB.AS || cp === 0x25cc
}

function isDottedCircle(ch: string): boolean {
  return ch.codePointAt(0)! === 0x25cc
}

function isClosingClass(cls: LB): boolean {
  return cls === LB.CL || cls === LB.CP
}

function isFinalQuotation(cp: number): boolean {
  return cp === 0x00bb || cp === 0x2019 || cp === 0x201d || cp === 0x203a ||
    cp === 0x2e03 || cp === 0x2e05 || cp === 0x2e0a || cp === 0x2e0d || cp === 0x2e1d
}

function isInitialQuotation(cp: number): boolean {
  return cp === 0x00ab || cp === 0x2018 || cp === 0x201c || cp === 0x2039 ||
    cp === 0x2e02 || cp === 0x2e04 || cp === 0x2e09 || cp === 0x2e0c || cp === 0x2e1c
}

function isFinalQuotationContext(chars: readonly string[], quoteIndex: number): boolean {
  const nextIndex = nextNonCombiningIndex(chars, quoteIndex + 1)
  if (nextIndex >= chars.length) return true
  const cp = chars[nextIndex]!.codePointAt(0)!
  const cls = resolveClass(lineBreakClass(cp), cp)
  return cls === LB.SP || cls === LB.GL || cls === LB.WJ || cls === LB.CL || cls === LB.QU ||
    cls === LB.CP || cls === LB.EX || cls === LB.IS || cls === LB.SY ||
    cls === LB.BK || cls === LB.CR || cls === LB.LF || cls === LB.NL || cls === LB.ZW
}

function shouldKeepQuotationTogether(
  chars: readonly string[],
  breakIndex: number,
  left: LB,
  right: LB,
  leftCp: number,
  rightCp: number,
): boolean {
  if (right === LB.QU && isCurlyInitialQuotation(rightCp) && isEastAsianWidth(leftCp) && isEastAsianAfterQuotation(chars, breakIndex)) return false
  if (left === LB.QU && isCurlyFinalQuotation(leftCp) && breakIndex < chars.length && isEastAsianWidth(rightCp) && isEastAsianBeforeQuotation(chars, breakIndex - 1)) return false
  if (right === LB.QU && isFinalQuotation(rightCp) && isEastAsianWidth(leftCp) && !isFinalQuotationContext(chars, breakIndex)) return true
  return true
}

function isInitialQuotationBlockedAfter(chars: readonly string[], quoteIndex: number): boolean {
  const previousIndex = previousNonCombiningIndex(chars, quoteIndex - 1)
  if (previousIndex < 0) return true
  const cp = chars[previousIndex]!.codePointAt(0)!
  const cls = resolveClass(lineBreakClass(cp), cp)
  return cls === LB.BK || cls === LB.CR || cls === LB.LF || cls === LB.NL ||
    cls === LB.OP || cls === LB.QU || cls === LB.GL || cls === LB.SP || cls === LB.ZW
}

function isEastAsianAfterQuotation(chars: readonly string[], quoteIndex: number): boolean {
  const nextIndex = nextNonCombiningIndex(chars, quoteIndex + 1)
  if (nextIndex >= chars.length) return false
  return isEastAsianWidth(chars[nextIndex]!.codePointAt(0)!)
}

function isEastAsianBeforeQuotation(chars: readonly string[], quoteIndex: number): boolean {
  const previousIndex = previousNonCombiningIndex(chars, quoteIndex - 1)
  if (previousIndex < 0) return false
  return isEastAsianWidth(chars[previousIndex]!.codePointAt(0)!)
}

function isArabicBreakAfter(cp: number): boolean {
  return cp === 0x060c || cp === 0x060d || cp === 0x061b || cp === 0x061f || cp === 0x06d4
}

function isCurlyInitialQuotation(cp: number): boolean {
  return cp === 0x2018 || cp === 0x201c
}

function isCurlyFinalQuotation(cp: number): boolean {
  return cp === 0x2019 || cp === 0x201d
}

function isExtendedPictographic(cp: number): boolean {
  return (cp >= 0x1f000 && cp <= 0x1f7ff) ||
    (cp >= 0x1f800 && cp <= 0x1f8ff) ||
    (cp >= 0x1fc00 && cp <= 0x1fffd)
}

function isCombiningLike(cls: LB, cp: number): boolean {
  return cls === LB.CM || (cls === LB.SA && isCombiningMark(cp))
}

function isCombiningSequenceStarter(cls: LB): boolean {
  return cls === LB.BK || cls === LB.CR || cls === LB.LF || cls === LB.NL || cls === LB.SP || cls === LB.ZW
}

function isPrefixPostfix(cls: LB): boolean {
  return cls === LB.PR || cls === LB.PO
}

function isHangulSyllableClass(cls: LB): boolean {
  return cls === LB.JL || cls === LB.JV || cls === LB.JT || cls === LB.H2 || cls === LB.H3
}

function isWordInitialHyphen(chars: readonly string[], leftBaseIndex: number, left: LB, right: LB): boolean {
  if (left !== LB.HY && left !== LB.HH) return false
  if (!isAlphabeticLetter(right) && right !== LB.HL) return false
  if (leftBaseIndex > 0) {
    const rawBeforeCp = chars[leftBaseIndex - 1]!.codePointAt(0)!
    const rawBefore = lineBreakClass(rawBeforeCp)
    if (rawBefore === LB.ZWJ || isCombiningLike(rawBefore, rawBeforeCp)) return false
  }
  const before = previousNonCombiningClass(chars, leftBaseIndex - 1)
  return before === LB.BK || before === LB.CR || before === LB.LF || before === LB.NL || before === LB.SP || before === LB.ZW || before === LB.CB || before === LB.GL || leftBaseIndex === 0
}

function isNumericSequencePair(left: LB, right: LB): boolean {
  if (left === LB.NU && (right === LB.NU || right === LB.SY || right === LB.IS || right === LB.PO)) return true
  if (left === LB.IS && right === LB.NU) return true
  if ((left === LB.PR || left === LB.PO) && right === LB.NU) return true
  if ((left === LB.OP || left === LB.HY) && right === LB.NU) return true
  if (left === LB.NU && (right === LB.PR || right === LB.PO || right === LB.CL || right === LB.CP)) return true
  return false
}

function isNumericAfterOpening(chars: readonly string[], index: number): boolean {
  let i = nextNonCombiningIndex(chars, index)
  if (i >= chars.length) return false
  let cls = getResolvedClass(chars, i)
  if (cls === LB.IS) {
    i = nextNonCombiningIndex(chars, i + 1)
    if (i >= chars.length) return false
    cls = getResolvedClass(chars, i)
  }
  return cls === LB.NU
}

function isNumericBeforeClosing(chars: readonly string[], index: number): boolean {
  let i = previousNonCombiningIndex(chars, index)
  if (i < 0) return false
  let cls = getResolvedClass(chars, i)
  while (cls === LB.NU || cls === LB.SY || cls === LB.IS) {
    if (cls === LB.NU) return true
    i = previousNonCombiningIndex(chars, i - 1)
    if (i < 0) return false
    cls = getResolvedClass(chars, i)
  }
  return false
}

function lineBreakClass(cp: number): LB {
  let lo = 0
  let hi = LINE_BREAK_RANGES.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const range = LINE_BREAK_RANGES[mid]!
    if (cp < range[0]) hi = mid - 1
    else if (cp > range[1]) lo = mid + 1
    else return range[2] as LB
  }
  if ((cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff)) return LB.ID
  if ((cp >= 0x20000 && cp <= 0x3fffd) || (cp >= 0x1f000 && cp <= 0x1f7ff) || (cp >= 0x1f900 && cp <= 0x1faff) || (cp >= 0x1fc00 && cp <= 0x1fffd)) return LB.ID
  if (cp >= 0x20a0 && cp <= 0x20cf) return LB.PR
  return LB.XX
}

function isCombiningMark(cp: number): boolean {
  return (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x0483 && cp <= 0x0489) ||
    (cp >= 0x0591 && cp <= 0x05bd) ||
    cp === 0x05bf ||
    (cp >= 0x05c1 && cp <= 0x05c2) ||
    (cp >= 0x05c4 && cp <= 0x05c5) ||
    cp === 0x05c7 ||
    (cp >= 0x0610 && cp <= 0x061a) ||
    (cp >= 0x064b && cp <= 0x065f) ||
    cp === 0x0670 ||
    (cp >= 0x06d6 && cp <= 0x06dc) ||
    (cp >= 0x06df && cp <= 0x06e4) ||
    (cp >= 0x06e7 && cp <= 0x06e8) ||
    (cp >= 0x06ea && cp <= 0x06ed) ||
    (cp >= 0x0900 && cp <= 0x0903) ||
    (cp >= 0x093a && cp <= 0x094d) ||
    (cp >= 0x0951 && cp <= 0x0957) ||
    (cp >= 0x0981 && cp <= 0x0983) ||
    (cp >= 0x09bc && cp <= 0x09cd) ||
    (cp >= 0x0a01 && cp <= 0x0a03) ||
    (cp >= 0x0a3c && cp <= 0x0a4d) ||
    (cp >= 0x0a70 && cp <= 0x0a71) ||
    (cp >= 0x0abc && cp <= 0x0acd) ||
    (cp >= 0x0b01 && cp <= 0x0b03) ||
    (cp >= 0x0b3c && cp <= 0x0b4d) ||
    (cp >= 0x0bbe && cp <= 0x0bcd) ||
    (cp >= 0x0c00 && cp <= 0x0c4d) ||
    (cp >= 0x0c55 && cp <= 0x0c56) ||
    (cp >= 0x0cbc && cp <= 0x0ccd) ||
    (cp >= 0x0d00 && cp <= 0x0d4d) ||
    (cp >= 0x0d81 && cp <= 0x0dca) ||
    (cp >= 0x0dd2 && cp <= 0x0dd6) ||
    (cp >= 0x0e31 && cp <= 0x0e4e) ||
    (cp >= 0x0eb1 && cp <= 0x0ecd) ||
    (cp >= 0x102b && cp <= 0x103e) ||
    (cp >= 0x1056 && cp <= 0x1059) ||
    (cp >= 0x1712 && cp <= 0x1715) ||
    (cp >= 0x1732 && cp <= 0x1734) ||
    (cp >= 0x17b4 && cp <= 0x17d3) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xe0100 && cp <= 0xe01ef)
}

function isEastAsianWidth(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x2329 && cp <= 0x232a) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xffef) ||
    (cp >= 0x1f000 && cp <= 0x1fffd) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
}
