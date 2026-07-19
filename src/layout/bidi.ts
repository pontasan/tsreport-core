/**
 * Unicode Bidirectional Algorithm (UAX #9)
 *
 * Reorders logical-order text into visual order.
 * Required to correctly display text mixing LTR/RTL scripts.
 *
 * Full implementation of UAX #9 (Unicode 17.0):
 * - P2-P3: paragraph level detection (skipping isolate content per BD8/BD9)
 * - X1-X8: explicit levels via the directional status stack
 *   (embeddings, overrides, isolates, overflow handling, max depth 125)
 * - X9-X10: level runs (BD13) and isolating run sequences with sos/eos
 * - W1-W7: weak type resolution per isolating run sequence
 * - N0: bracket pair resolution (BD16) with the full BidiBrackets.txt table
 * - N1-N2: neutral and isolate formatting type resolution
 * - I1-I2: implicit levels, L1: level reset, L2: reordering
 * - Character classification from the full DerivedBidiClass.txt range table
 *   (all planes, binary search over merged ranges)
 * - Mirrored glyph mapping from the full BidiMirroring.txt table
 */

// ─── Public interface ───

/** BiDi processing result */
export interface BidiResult {
  /** Code point index array in visual order */
  visualOrder: number[]
  /** Embedding level of each character */
  levels: Uint8Array
  /** Base direction of the paragraph */
  paragraphLevel: number
}

/** Options for BiDi processing */
export interface BidiOptions {
  /** Base direction of the paragraph (auto-detected if not specified) */
  direction?: 'ltr' | 'rtl' | 'auto'
}

/** Run BiDi processing */
export function resolveBidi(text: string, options?: BidiOptions): BidiResult {
  const codePoints = stringToCodePoints(text)
  const len = codePoints.length
  if (len === 0) {
    return { visualOrder: [], levels: new Uint8Array(0), paragraphLevel: 0 }
  }

  // Original BiDi classes (never modified; used by X5c, X10, N0 and L1)
  const origTypes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    origTypes[i] = getBidiClass(codePoints[i]!)
  }

  // BD9: matching PDI for each isolate initiator and vice versa
  const matchPDI = new Int32Array(len).fill(-1)
  const matchIso = new Int32Array(len).fill(-1)
  computeIsolateMatches(origTypes, matchPDI, matchIso, len)

  // P2-P3: determine paragraph level
  const dir = options?.direction ?? 'auto'
  let paragraphLevel: number
  if (dir === 'rtl') {
    paragraphLevel = 1
  } else if (dir === 'ltr') {
    paragraphLevel = 0
  } else {
    paragraphLevel = detectParagraphLevel(origTypes, 0, len)
  }

  // Working types (modified by X override resets and W/N rules)
  const types = origTypes.slice()
  const levels = new Uint8Array(len)

  // X1-X8: resolve explicit embedding levels
  resolveExplicitLevels(types, origTypes, levels, matchPDI, paragraphLevel, len)

  // Snapshot of types right after the X rules (before W1).
  // Needed by the NSM clause of rule N0.
  const xTypes = types.slice()

  // X9: build the processing sequence excluding removed characters
  // (RLE, LRE, RLO, LRO, PDF, BN). BT_BN..BT_PDF are contiguous constants.
  const proc = new Int32Array(len)
  let procLen = 0
  for (let i = 0; i < len; i++) {
    const t = origTypes[i]!
    if (t < BT_BN || t > BT_PDF) proc[procLen++] = i
  }
  const procPos = new Int32Array(len).fill(-1)
  for (let k = 0; k < procLen; k++) procPos[proc[k]!] = k

  // BD13: compute level runs over the processing sequence
  const runStart: number[] = [] // processing-sequence position of run start
  const runEnd: number[] = []   // processing-sequence position past run end
  let rk = 0
  while (rk < procLen) {
    const level = levels[proc[rk]!]!
    const start = rk
    rk++
    while (rk < procLen && levels[proc[rk]!]! === level) rk++
    runStart.push(start)
    runEnd.push(rk)
  }
  const runCount = runStart.length
  const runIdByStart = new Int32Array(procLen)
  for (let r = 0; r < runCount; r++) runIdByStart[runStart[r]!] = r

  // X10: assemble isolating run sequences and apply W/N rules to each
  const seqIdx = new Int32Array(procLen) // reused buffer of original indices
  for (let r = 0; r < runCount; r++) {
    const firstOfRun = proc[runStart[r]!]!
    // A level run whose first character is a PDI matching an isolate
    // initiator is a continuation of that initiator's sequence.
    if (origTypes[firstOfRun] === BT_PDI && matchIso[firstOfRun]! !== -1) continue

    let seqLen = 0
    let cur = r
    for (;;) {
      for (let k = runStart[cur]!; k < runEnd[cur]!; k++) seqIdx[seqLen++] = proc[k]!
      const lastI = seqIdx[seqLen - 1]!
      const lt = origTypes[lastI]!
      if (lt >= BT_LRI && lt <= BT_FSI && matchPDI[lastI]! !== -1) {
        // The matching PDI of a valid initiator always starts a level run
        cur = runIdByStart[procPos[matchPDI[lastI]!]!]!
      } else {
        break
      }
    }

    const seqLevel = levels[seqIdx[0]!]!

    // sos: compare the sequence level with the level of the preceding
    // retained character (or the paragraph level at text start)
    const firstK = procPos[seqIdx[0]!]!
    const prevLevel = firstK > 0 ? levels[proc[firstK - 1]!]! : paragraphLevel
    const sos = ((seqLevel > prevLevel ? seqLevel : prevLevel) & 1) ? BT_R : BT_L

    // eos: same with the following retained character, except when the
    // sequence ends with an isolate initiator lacking a matching PDI
    // (a matched initiator would have continued the sequence above)
    const lastI = seqIdx[seqLen - 1]!
    const lastT = origTypes[lastI]!
    let nextLevel: number
    if (lastT >= BT_LRI && lastT <= BT_FSI) {
      nextLevel = paragraphLevel
    } else {
      const lastK = procPos[lastI]!
      nextLevel = lastK + 1 < procLen ? levels[proc[lastK + 1]!]! : paragraphLevel
    }
    const eos = ((seqLevel > nextLevel ? seqLevel : nextLevel) & 1) ? BT_R : BT_L

    resolveWeakTypes(types, seqIdx, seqLen, sos)
    resolveBracketPairs(types, xTypes, codePoints, seqIdx, seqLen, sos, seqLevel)
    resolveNeutralTypes(types, seqIdx, seqLen, sos, eos, seqLevel)
  }

  // I1-I2: resolve implicit levels
  for (let k = 0; k < procLen; k++) {
    const i = proc[k]!
    const level = levels[i]!
    const t = types[i]!
    if (level & 1) {
      if (t === BT_L || t === BT_EN || t === BT_AN) levels[i] = level + 1
    } else {
      if (t === BT_R) levels[i] = level + 1
      else if (t === BT_EN || t === BT_AN) levels[i] = level + 2
    }
  }

  // Characters removed by X9 take the level of the preceding retained
  // character (UAX #9 5.2, retaining explicit formatting characters)
  let carryLevel = paragraphLevel
  for (let i = 0; i < len; i++) {
    const t = origTypes[i]!
    if (t >= BT_BN && t <= BT_PDF) levels[i] = carryLevel
    else carryLevel = levels[i]!
  }

  // L1: reset segment/paragraph separators and any preceding or trailing
  // run of whitespace / formatting characters to the paragraph level
  // (uses original types, not the resolved ones)
  let reset = true
  for (let i = len - 1; i >= 0; i--) {
    const t = origTypes[i]!
    if (t === BT_B || t === BT_S) {
      levels[i] = paragraphLevel
      reset = true
    } else if (t === BT_WS || (t >= BT_BN && t <= BT_PDI)) {
      if (reset) levels[i] = paragraphLevel
    } else {
      reset = false
    }
  }

  // L2: reverse visual order based on levels
  const visualOrder = computeVisualOrder(levels, len)

  return { visualOrder, levels, paragraphLevel }
}

/** Mapping for characters that require mirroring (full BidiMirroring.txt) */
export function getMirrorChar(cp: number): number {
  let lo = 0
  let hi = MIRROR_FROM.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const v = MIRROR_FROM[mid]!
    if (v === cp) return MIRROR_TO[mid]!
    if (v < cp) lo = mid + 1
    else hi = mid - 1
  }
  return cp
}

/** Determine the base direction of text (P2-P3, skipping isolate content) */
export function getBaseDirection(text: string): 'ltr' | 'rtl' {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i)
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1)
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        cp = ((cp - 0xD800) << 10) + (lo - 0xDC00) + 0x10000
        i++
      }
    }
    const t = getBidiClass(cp)
    if (t >= BT_LRI && t <= BT_FSI) { depth++; continue }
    if (t === BT_PDI) { if (depth > 0) depth--; continue }
    if (depth > 0) continue
    if (t === BT_L) return 'ltr'
    if (t === BT_R || t === BT_AL) return 'rtl'
  }
  return 'ltr'
}

// ─── BiDi type constants ───
// Values match the encoding of the generated BIDI_CLASS_VALUES table.
// BT_BN..BT_PDF (13..18) are the characters removed by rule X9;
// BT_LRI..BT_FSI (19..21) are the isolate initiators.

const BT_L = 0    // Left-to-Right
const BT_R = 1    // Right-to-Left
const BT_EN = 2   // European Number
const BT_ES = 3   // European Separator
const BT_ET = 4   // European Terminator
const BT_AN = 5   // Arabic Number
const BT_CS = 6   // Common Separator
const BT_B = 7    // Paragraph Separator
const BT_S = 8    // Segment Separator
const BT_WS = 9   // Whitespace
const BT_ON = 10  // Other Neutral
const BT_AL = 11  // Arabic Letter
const BT_NSM = 12 // Non-Spacing Mark
const BT_BN = 13  // Boundary Neutral
const BT_LRE = 14 // Left-to-Right Embedding
const BT_RLE = 15 // Right-to-Left Embedding
const BT_LRO = 16 // Left-to-Right Override
const BT_RLO = 17 // Right-to-Left Override
const BT_PDF = 18 // Pop Directional Format
const BT_LRI = 19 // Left-to-Right Isolate
const BT_RLI = 20 // Right-to-Left Isolate
const BT_FSI = 21 // First Strong Isolate
const BT_PDI = 22 // Pop Directional Isolate

/** Maximum explicit depth (UAX #9 BD2) */
const MAX_DEPTH = 125

/** Maximum bracket pair stack depth (BD16) */
const BRACKET_STACK_MAX = 63

// ─── BiDi type classification ───

/** Look up the BiDi class of a code point (binary search over range table) */
function getBidiClass(cp: number): number {
  let lo = 0
  let hi = BIDI_CLASS_STARTS.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (BIDI_CLASS_STARTS[mid]! <= cp) lo = mid
    else hi = mid - 1
  }
  return BIDI_CLASS_VALUES[lo]!
}

// ─── BD9: isolate initiator / PDI matching ───

function computeIsolateMatches(
  origTypes: Uint8Array,
  matchPDI: Int32Array,
  matchIso: Int32Array,
  len: number,
): void {
  const stack: number[] = []
  for (let i = 0; i < len; i++) {
    const t = origTypes[i]!
    if (t >= BT_LRI && t <= BT_FSI) {
      stack.push(i)
    } else if (t === BT_PDI && stack.length > 0) {
      const j = stack.pop()!
      matchPDI[j] = i
      matchIso[i] = j
    }
  }
}

// ─── Paragraph level detection (P2-P3) ───

/**
 * Find the first strong character in origTypes[from..to), skipping
 * characters between an isolate initiator and its matching PDI.
 */
function detectParagraphLevel(origTypes: Uint8Array, from: number, to: number): number {
  let depth = 0
  for (let i = from; i < to; i++) {
    const t = origTypes[i]!
    if (t >= BT_LRI && t <= BT_FSI) { depth++; continue }
    if (t === BT_PDI) { if (depth > 0) depth--; continue }
    if (depth > 0) continue
    if (t === BT_L) return 0
    if (t === BT_R || t === BT_AL) return 1
  }
  return 0 // P3: default LTR
}

// ─── Explicit level resolution (X1-X8) ───

function resolveExplicitLevels(
  types: Uint8Array,
  origTypes: Uint8Array,
  levels: Uint8Array,
  matchPDI: Int32Array,
  paragraphLevel: number,
  len: number,
): void {
  // Directional status stack (X1): level, override status, isolate status
  const stackLevel = new Uint8Array(MAX_DEPTH + 2)
  const stackOverride = new Uint8Array(MAX_DEPTH + 2) // 0 neutral, 1 LTR, 2 RTL
  const stackIsolate = new Uint8Array(MAX_DEPTH + 2)
  let sp = 0
  stackLevel[0] = paragraphLevel
  let overflowIsolate = 0
  let overflowEmbedding = 0
  let validIsolate = 0

  for (let i = 0; i < len; i++) {
    const t = types[i]!
    switch (t) {
      case BT_RLE:
      case BT_LRE:
      case BT_RLO:
      case BT_LRO: {
        // X2-X5
        levels[i] = stackLevel[sp]!
        const newLevel = (t === BT_RLE || t === BT_RLO)
          ? (stackLevel[sp]! + 1) | 1   // least odd level greater than current
          : (stackLevel[sp]! + 2) & ~1  // least even level greater than current
        if (newLevel <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) {
          sp++
          stackLevel[sp] = newLevel
          stackOverride[sp] = t === BT_RLO ? 2 : t === BT_LRO ? 1 : 0
          stackIsolate[sp] = 0
        } else if (overflowIsolate === 0) {
          overflowEmbedding++
        }
        types[i] = BT_BN // removed by X9
        break
      }
      case BT_LRI:
      case BT_RLI:
      case BT_FSI: {
        // X5a/X5b/X5c
        let isolateType = t
        if (t === BT_FSI) {
          // X5c: apply P2-P3 to the text between the FSI and its matching PDI
          const end = matchPDI[i]! === -1 ? len : matchPDI[i]!
          isolateType = detectParagraphLevel(origTypes, i + 1, end) === 1 ? BT_RLI : BT_LRI
        }
        levels[i] = stackLevel[sp]!
        const ov = stackOverride[sp]!
        if (ov === 1) types[i] = BT_L
        else if (ov === 2) types[i] = BT_R
        const newLevel = isolateType === BT_RLI
          ? (stackLevel[sp]! + 1) | 1
          : (stackLevel[sp]! + 2) & ~1
        if (newLevel <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) {
          validIsolate++
          sp++
          stackLevel[sp] = newLevel
          stackOverride[sp] = 0
          stackIsolate[sp] = 1
        } else {
          overflowIsolate++
        }
        break
      }
      case BT_PDI: {
        // X6a
        if (overflowIsolate > 0) {
          overflowIsolate--
        } else if (validIsolate > 0) {
          overflowEmbedding = 0
          while (stackIsolate[sp] === 0) sp--
          sp--
          validIsolate--
        }
        levels[i] = stackLevel[sp]!
        const ov = stackOverride[sp]!
        if (ov === 1) types[i] = BT_L
        else if (ov === 2) types[i] = BT_R
        break
      }
      case BT_PDF: {
        // X7
        if (overflowIsolate === 0) {
          if (overflowEmbedding > 0) overflowEmbedding--
          else if (stackIsolate[sp] === 0 && sp > 0) sp--
        }
        levels[i] = stackLevel[sp]!
        types[i] = BT_BN // removed by X9
        break
      }
      case BT_B: {
        // X8
        levels[i] = paragraphLevel
        break
      }
      case BT_BN: {
        levels[i] = stackLevel[sp]!
        break
      }
      default: {
        // X6
        levels[i] = stackLevel[sp]!
        const ov = stackOverride[sp]!
        if (ov === 1) types[i] = BT_L
        else if (ov === 2) types[i] = BT_R
        break
      }
    }
  }
}

// ─── Weak type resolution (W1-W7) per isolating run sequence ───

function resolveWeakTypes(
  types: Uint8Array,
  seq: Int32Array,
  seqLen: number,
  sos: number,
): void {
  // W1: NSM takes the type of the previous character
  // (ON when following an isolate initiator or PDI, sos at sequence start)
  let prev = sos
  for (let k = 0; k < seqLen; k++) {
    const i = seq[k]!
    if (types[i] === BT_NSM) {
      types[i] = (prev >= BT_LRI && prev <= BT_PDI) ? BT_ON : prev
    }
    prev = types[i]!
  }

  // W2: EN with a preceding strong type of AL becomes AN
  let strong = sos
  for (let k = 0; k < seqLen; k++) {
    const i = seq[k]!
    const t = types[i]!
    if (t === BT_L || t === BT_R || t === BT_AL) strong = t
    else if (t === BT_EN && strong === BT_AL) types[i] = BT_AN
  }

  // W3: AL becomes R
  for (let k = 0; k < seqLen; k++) {
    if (types[seq[k]!] === BT_AL) types[seq[k]!] = BT_R
  }

  // W4: single ES between two EN becomes EN;
  // single CS between two EN (or two AN) becomes EN (AN)
  for (let k = 1; k + 1 < seqLen; k++) {
    const i = seq[k]!
    const t = types[i]!
    if (t !== BT_ES && t !== BT_CS) continue
    const p = types[seq[k - 1]!]!
    const n = types[seq[k + 1]!]!
    if (p === BT_EN && n === BT_EN) types[i] = BT_EN
    else if (t === BT_CS && p === BT_AN && n === BT_AN) types[i] = BT_AN
  }

  // W5: a sequence of ET adjacent to EN becomes EN
  for (let k = 0; k < seqLen; k++) {
    if (types[seq[k]!] !== BT_ET) continue
    const start = k
    while (k < seqLen && types[seq[k]!] === BT_ET) k++
    const adjacentEN =
      (start > 0 && types[seq[start - 1]!] === BT_EN) ||
      (k < seqLen && types[seq[k]!] === BT_EN)
    if (adjacentEN) {
      for (let j = start; j < k; j++) types[seq[j]!] = BT_EN
    }
    k--
  }

  // W6: remaining ES, ET, CS become ON
  for (let k = 0; k < seqLen; k++) {
    const i = seq[k]!
    const t = types[i]!
    if (t === BT_ES || t === BT_ET || t === BT_CS) types[i] = BT_ON
  }

  // W7: EN with a preceding strong type of L becomes L
  strong = sos
  for (let k = 0; k < seqLen; k++) {
    const i = seq[k]!
    const t = types[i]!
    if (t === BT_L || t === BT_R) strong = t
    else if (t === BT_EN && strong === BT_L) types[i] = BT_L
  }
}

// ─── Bracket pair resolution (N0, BD16) ───

/** Strong direction of a resolved type for N0/N1: EN and AN count as R */
function strongDirection(t: number): number {
  if (t === BT_L) return BT_L
  if (t === BT_R || t === BT_EN || t === BT_AN) return BT_R
  return -1
}

/** Canonical equivalence for bracket matching (U+2329/U+232A ≡ U+3008/U+3009) */
function canonicalBracket(cp: number): number {
  if (cp === 0x3008) return 0x2329
  if (cp === 0x3009) return 0x232A
  return cp
}

/** Find the BidiBrackets.txt entry index of a code point, or -1 */
function findBracketEntry(cp: number): number {
  let lo = 0
  let hi = BRACKET_CP.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const v = BRACKET_CP[mid]!
    if (v === cp) return mid
    if (v < cp) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/** Set a bracket's type and propagate to characters that were NSM before W1 */
function setBracketType(
  types: Uint8Array,
  xTypes: Uint8Array,
  seq: Int32Array,
  seqLen: number,
  k: number,
  direction: number,
): void {
  types[seq[k]!] = direction
  for (let j = k + 1; j < seqLen; j++) {
    if (xTypes[seq[j]!] !== BT_NSM) break
    types[seq[j]!] = direction
  }
}

function resolveBracketPairs(
  types: Uint8Array,
  xTypes: Uint8Array,
  codePoints: number[],
  seq: Int32Array,
  seqLen: number,
  sos: number,
  seqLevel: number,
): void {
  // BD16: identify bracket pairs with a fixed-depth stack
  const stackClose = new Int32Array(BRACKET_STACK_MAX) // expected closing cp
  const stackPos = new Int32Array(BRACKET_STACK_MAX)   // sequence position of opening
  let sp = 0
  const pairOpen: number[] = []
  const pairClose: number[] = []
  for (let k = 0; k < seqLen; k++) {
    const i = seq[k]!
    if (types[i] !== BT_ON) continue
    const cp = codePoints[i]!
    const bi = findBracketEntry(cp)
    if (bi < 0) continue
    if (BRACKET_TYPE[bi] === 1) {
      // Opening bracket: BD16 stops entirely when the stack is exhausted
      if (sp === BRACKET_STACK_MAX) break
      stackClose[sp] = canonicalBracket(BRACKET_PAIR[bi]!)
      stackPos[sp] = k
      sp++
    } else {
      // Closing bracket: search the stack from the top down; on a match,
      // record the pair and pop the matched element and everything above it
      const c = canonicalBracket(cp)
      for (let j = sp - 1; j >= 0; j--) {
        if (stackClose[j] === c) {
          pairOpen.push(stackPos[j]!)
          pairClose.push(k)
          sp = j
          break
        }
      }
    }
  }

  const pairCount = pairOpen.length
  if (pairCount === 0) return

  // Sort pairs by opening bracket position (insertion sort; counts are small)
  for (let a = 1; a < pairCount; a++) {
    const po = pairOpen[a]!
    const pc = pairClose[a]!
    let b = a - 1
    while (b >= 0 && pairOpen[b]! > po) {
      pairOpen[b + 1] = pairOpen[b]!
      pairClose[b + 1] = pairClose[b]!
      b--
    }
    pairOpen[b + 1] = po
    pairClose[b + 1] = pc
  }

  const e = (seqLevel & 1) ? BT_R : BT_L
  const o = (seqLevel & 1) ? BT_L : BT_R

  // N0: process each pair in order
  for (let p = 0; p < pairCount; p++) {
    const po = pairOpen[p]!
    const pc = pairClose[p]!
    // N0 a-b: inspect the enclosed characters; a strong type matching the
    // embedding direction anywhere inside wins
    let found = 0 // 0: none, 1: opposite direction only, 2: embedding direction
    for (let k = po + 1; k < pc; k++) {
      const s = strongDirection(types[seq[k]!]!)
      if (s === e) { found = 2; break }
      if (s === o) found = 1
    }
    if (found === 0) continue // N0 d: leave brackets unresolved
    let direction = e
    if (found === 1) {
      // N0 c: opposite-direction strong type inside; check the context
      // established before the opening bracket (first preceding strong, sos)
      let context = sos
      for (let k = po - 1; k >= 0; k--) {
        const s = strongDirection(types[seq[k]!]!)
        if (s !== -1) { context = s; break }
      }
      direction = context === o ? o : e
    }
    setBracketType(types, xTypes, seq, seqLen, po, direction)
    setBracketType(types, xTypes, seq, seqLen, pc, direction)
  }
}

// ─── Neutral type resolution (N1-N2) ───

/** NI per UAX #9: neutral or isolate formatting character */
function isNeutralOrIsolate(t: number): boolean {
  return t === BT_B || t === BT_S || t === BT_WS || t === BT_ON ||
    (t >= BT_LRI && t <= BT_PDI)
}

function resolveNeutralTypes(
  types: Uint8Array,
  seq: Int32Array,
  seqLen: number,
  sos: number,
  eos: number,
  seqLevel: number,
): void {
  const e = (seqLevel & 1) ? BT_R : BT_L
  let k = 0
  while (k < seqLen) {
    if (!isNeutralOrIsolate(types[seq[k]!]!)) { k++; continue }
    const start = k
    while (k < seqLen && isNeutralOrIsolate(types[seq[k]!]!)) k++
    // N1: NIs between two strong types of the same direction take that
    // direction (EN and AN count as R); sos/eos bound the sequence
    const before = start > 0 ? strongDirection(types[seq[start - 1]!]!) : sos
    const after = k < seqLen ? strongDirection(types[seq[k]!]!) : eos
    // N2: otherwise NIs take the embedding direction
    const value = before === after ? before : e
    for (let j = start; j < k; j++) types[seq[j]!] = value
  }
}

// ─── Visual order computation (L2) ───

function computeVisualOrder(levels: Uint8Array, len: number): number[] {
  const order = new Array<number>(len)
  for (let i = 0; i < len; i++) order[i] = i

  // Find the maximum level and the minimum odd level
  let maxLevel = 0
  let minOddLevel = 256
  for (let i = 0; i < len; i++) {
    const l = levels[i]!
    if (l > maxLevel) maxLevel = l
    if ((l & 1) && l < minOddLevel) minOddLevel = l
  }

  // Reverse from the highest level down
  for (let level = maxLevel; level >= minOddLevel; level--) {
    let i = 0
    while (i < len) {
      // Find the start of a run at or above this level
      if (levels[i]! < level) { i++; continue }
      const start = i
      while (i < len && levels[i]! >= level) i++
      // Reverse start..i-1
      let lo = start
      let hi = i - 1
      while (lo < hi) {
        const tmp = order[lo]!
        order[lo] = order[hi]!
        order[hi] = tmp
        lo++
        hi--
      }
    }
  }

  return order
}

// ─── String → code point array conversion (surrogate pair aware) ───

function stringToCodePoints(text: string): number[] {
  const result: number[] = []
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i)
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1)
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        cp = ((cp - 0xD800) << 10) + (lo - 0xDC00) + 0x10000
        i++
      }
    }
    result.push(cp)
  }
  return result
}

// ─── Generated data tables (Unicode 17.0.0: DerivedBidiClass.txt, BidiMirroring.txt, BidiBrackets.txt) ───

/** Range starts for BiDi class lookup (sorted ascending, covers U+0000..U+10FFFF). */
const BIDI_CLASS_STARTS = new Uint32Array([0,9,10,11,12,13,14,28,31,32,33,35,38,43,44,45,46,48,58,59,65,91,97,123,127,133,134,160,161,162,166,170,171,173,174,176,178,180,181,182,185,186,187,192,215,216,247,248,697,699,706,720,722,736,741,750,751,768,880,884,886,894,895,900,902,903,904,1014,1015,1155,1162,1418,1419,1421,1423,1424,1425,1470,1471,1472,1473,1475,1476,1478,1479,1480,1536,1542,1544,1545,1547,1548,1549,1550,1552,1563,1611,1632,1642,1643,1645,1648,1649,1750,1757,1758,1759,1765,1767,1769,1770,1774,1776,1786,1809,1810,1840,1867,1958,1969,1984,2027,2036,2038,2042,2045,2046,2070,2074,2075,2084,2085,2088,2089,2094,2137,2140,2144,2192,2194,2199,2208,2250,2274,2275,2307,2362,2363,2364,2365,2369,2377,2381,2382,2385,2392,2402,2404,2433,2434,2492,2493,2497,2501,2509,2510,2530,2532,2546,2548,2555,2556,2558,2559,2561,2563,2620,2621,2625,2627,2631,2633,2635,2638,2641,2642,2672,2674,2677,2678,2689,2691,2748,2749,2753,2758,2759,2761,2765,2766,2786,2788,2801,2802,2810,2816,2817,2818,2876,2877,2879,2880,2881,2885,2893,2894,2901,2903,2914,2916,2946,2947,3008,3009,3021,3022,3059,3065,3066,3067,3072,3073,3076,3077,3132,3133,3134,3137,3142,3145,3146,3150,3157,3159,3170,3172,3192,3199,3201,3202,3260,3261,3276,3278,3298,3300,3328,3330,3387,3389,3393,3397,3405,3406,3426,3428,3457,3458,3530,3531,3538,3541,3542,3543,3633,3634,3636,3643,3647,3648,3655,3663,3761,3762,3764,3773,3784,3791,3864,3866,3893,3894,3895,3896,3897,3898,3902,3953,3967,3968,3973,3974,3976,3981,3992,3993,4029,4038,4039,4141,4145,4146,4152,4153,4155,4157,4159,4184,4186,4190,4193,4209,4213,4226,4227,4229,4231,4237,4238,4253,4254,4957,4960,5008,5018,5120,5121,5760,5761,5787,5789,5906,5909,5938,5940,5970,5972,6002,6004,6068,6070,6071,6078,6086,6087,6089,6100,6107,6108,6109,6110,6128,6138,6144,6155,6158,6159,6160,6277,6279,6313,6314,6432,6435,6439,6441,6450,6451,6457,6460,6464,6465,6468,6470,6622,6656,6679,6681,6683,6684,6742,6743,6744,6751,6752,6753,6754,6755,6757,6765,6771,6781,6783,6784,6832,6878,6880,6892,6912,6916,6964,6965,6966,6971,6972,6973,6978,6979,7019,7028,7040,7042,7074,7078,7080,7082,7083,7086,7142,7143,7144,7146,7149,7150,7151,7154,7212,7220,7222,7224,7376,7379,7380,7393,7394,7401,7405,7406,7412,7413,7416,7418,7616,7680,8125,8126,8127,8130,8141,8144,8157,8160,8173,8176,8189,8191,8192,8203,8206,8207,8208,8232,8233,8234,8235,8236,8237,8238,8239,8240,8245,8260,8261,8287,8288,8294,8295,8296,8297,8298,8304,8305,8308,8314,8316,8319,8320,8330,8332,8335,8352,8400,8433,8448,8450,8451,8455,8456,8458,8468,8469,8470,8473,8478,8484,8485,8486,8487,8488,8489,8490,8494,8495,8506,8508,8512,8517,8522,8526,8528,8544,8585,8588,8592,8722,8723,8724,9014,9083,9109,9110,9258,9280,9291,9312,9352,9372,9450,9900,9901,10240,10496,11124,11126,11264,11493,11499,11503,11506,11513,11520,11647,11648,11744,11776,11870,11904,11930,11931,12020,12032,12246,12272,12288,12289,12293,12296,12321,12330,12334,12336,12337,12342,12344,12349,12352,12441,12443,12445,12448,12449,12539,12540,12736,12774,12783,12784,12829,12831,12880,12896,12924,12927,12977,12992,13004,13008,13175,13179,13278,13280,13311,13312,19904,19968,42128,42183,42509,42512,42607,42611,42612,42622,42624,42654,42656,42736,42738,42752,42786,42888,42889,43010,43011,43014,43015,43019,43020,43045,43047,43048,43052,43053,43064,43066,43124,43128,43204,43206,43232,43250,43263,43264,43302,43310,43335,43346,43392,43395,43443,43444,43446,43450,43452,43454,43493,43494,43561,43567,43569,43571,43573,43575,43587,43588,43596,43597,43644,43645,43696,43697,43698,43701,43703,43705,43710,43712,43713,43714,43756,43758,43766,43767,43882,43884,44005,44006,44008,44009,44013,44014,64285,64286,64287,64297,64298,64336,64451,64467,64830,64848,64912,64914,64968,64976,65008,65021,65024,65040,65050,65056,65072,65104,65105,65106,65107,65108,65109,65110,65119,65120,65122,65124,65127,65128,65129,65131,65132,65136,65279,65280,65281,65283,65286,65291,65292,65293,65294,65296,65306,65307,65313,65339,65345,65371,65382,65504,65506,65509,65511,65512,65519,65520,65529,65534,65536,65793,65794,65856,65933,65936,65949,65952,65953,66045,66046,66272,66273,66300,66422,66427,67584,67871,67872,68097,68100,68101,68103,68108,68112,68152,68155,68159,68160,68325,68327,68409,68416,68864,68900,68904,68912,68922,68928,68938,68969,68974,68975,69216,69247,69291,69293,69312,69328,69337,69370,69376,69424,69446,69457,69488,69506,69510,69632,69633,69634,69688,69703,69714,69734,69744,69745,69747,69749,69759,69762,69811,69815,69817,69819,69826,69827,69888,69891,69927,69932,69933,69941,70003,70004,70016,70018,70070,70079,70089,70093,70095,70096,70191,70194,70196,70197,70198,70200,70206,70207,70209,70210,70367,70368,70371,70379,70400,70402,70459,70461,70464,70465,70502,70509,70512,70517,70587,70593,70606,70607,70608,70609,70610,70611,70625,70627,70712,70720,70722,70725,70726,70727,70750,70751,70835,70841,70842,70843,70847,70849,70850,70852,71090,71094,71100,71102,71103,71105,71132,71134,71219,71227,71229,71230,71231,71233,71264,71277,71339,71340,71341,71342,71344,71350,71351,71352,71453,71454,71455,71456,71458,71462,71463,71468,71727,71736,71737,71739,71995,71997,71998,71999,72003,72004,72148,72152,72154,72156,72160,72161,72193,72199,72201,72203,72243,72249,72251,72255,72263,72264,72273,72279,72281,72284,72330,72343,72344,72346,72544,72545,72546,72549,72550,72551,72752,72759,72760,72766,72850,72872,72874,72881,72882,72884,72885,72887,73009,73015,73018,73019,73020,73022,73023,73030,73031,73032,73104,73106,73109,73110,73111,73112,73459,73461,73472,73474,73526,73531,73536,73537,73538,73539,73562,73563,73685,73693,73697,73714,78912,78913,78919,78934,90398,90410,90413,90416,92912,92917,92976,92983,94031,94032,94095,94099,94178,94179,94180,94181,113821,113823,113824,113828,117760,117974,118000,118010,118013,118016,118452,118458,118481,118496,118513,118528,118574,118576,118599,119143,119146,119155,119163,119171,119173,119180,119210,119214,119273,119275,119296,119362,119365,119366,119552,119639,120513,120514,120539,120540,120571,120572,120597,120598,120629,120630,120655,120656,120687,120688,120713,120714,120745,120746,120771,120772,120782,120832,121344,121399,121403,121453,121461,121462,121476,121477,121499,121504,121505,121520,122880,122887,122888,122905,122907,122914,122915,122917,122918,122923,123023,123024,123184,123191,123566,123567,123628,123632,123647,123648,124140,124144,124398,124400,124643,124644,124646,124647,124654,124656,124661,124662,124928,125136,125143,125252,125259,126064,126144,126208,126288,126464,126704,126706,126720,126976,127020,127024,127124,127136,127151,127153,127168,127169,127184,127185,127222,127232,127243,127248,127279,127280,127338,127344,127405,127406,127584,127590,127744,128729,128732,128749,128752,128765,128768,128986,128992,129004,129008,129009,129024,129036,129040,129096,129104,129114,129120,129160,129168,129198,129200,129212,129216,129218,129232,129241,129280,129624,129632,129646,129648,129661,129664,129675,129678,129735,129736,129737,129741,129757,129759,129771,129775,129785,129792,129939,129940,130032,130042,130043,131070,131072,196606,196608,262142,262144,327678,327680,393214,393216,458750,458752,524286,524288,589822,589824,655358,655360,720894,720896,786430,786432,851966,851968,917502,917760,918000,921600,983038,983040,1048574,1048576,1114110])
/** BiDi class for each range in BIDI_CLASS_STARTS. */
const BIDI_CLASS_VALUES = new Uint8Array([13,8,7,8,9,7,13,7,8,9,10,4,10,3,6,3,6,2,6,10,0,10,0,10,13,7,13,6,10,4,10,0,10,13,10,4,2,10,0,10,2,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,12,0,10,0,10,0,10,0,10,0,10,0,12,0,10,0,10,4,1,12,1,12,1,12,1,12,1,12,1,5,10,11,4,11,6,11,10,12,11,12,5,4,5,11,12,11,12,5,10,12,11,12,10,12,11,2,11,12,11,12,11,12,11,1,12,1,10,1,12,1,12,1,12,1,12,1,12,1,12,1,11,5,11,12,11,12,5,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,4,0,4,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,4,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,10,4,10,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,10,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,4,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,10,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,10,0,10,0,9,0,10,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,4,0,12,0,10,0,10,12,13,12,0,12,0,12,0,12,0,12,0,12,0,12,0,10,0,10,0,10,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,10,0,10,0,10,0,10,0,10,0,10,0,9,13,0,1,10,9,7,14,15,18,16,17,6,4,10,6,10,9,13,19,20,21,22,13,2,0,2,3,10,0,2,3,10,0,4,12,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,4,0,10,0,10,0,10,0,10,0,10,0,10,3,4,10,0,10,0,10,0,10,0,10,2,0,10,0,10,0,10,0,10,0,10,0,12,0,10,0,12,0,12,10,0,10,0,10,0,10,0,10,9,10,0,10,0,12,0,10,0,10,0,10,0,12,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,12,10,12,10,0,12,0,12,0,10,0,10,0,12,0,12,0,12,0,12,0,10,12,0,4,0,10,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,10,0,12,0,12,0,12,0,1,12,1,3,1,11,10,11,10,11,10,11,10,13,11,10,12,10,0,12,10,6,10,6,0,10,6,10,4,10,3,10,0,10,4,10,0,11,13,0,10,4,10,3,6,3,6,2,6,10,0,10,0,10,0,4,10,4,0,10,0,13,10,13,0,10,0,10,0,10,0,10,0,12,0,12,2,0,12,0,1,10,1,12,1,12,1,12,1,12,1,12,1,12,1,10,1,11,12,11,5,11,5,1,12,10,1,5,1,12,1,11,10,11,12,1,11,12,11,1,12,1,0,12,0,12,0,10,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,10,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,10,4,10,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,10,0,12,0,12,0,13,0,10,0,2,10,0,10,0,10,0,10,0,12,0,12,0,12,0,13,12,0,12,0,12,0,10,0,10,12,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,2,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,12,0,4,0,12,0,12,0,12,0,12,0,12,0,12,0,1,12,1,12,1,11,1,11,1,11,10,11,1,10,0,10,0,10,0,10,0,10,0,10,0,2,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,0,10,2,10,0,13,0,13,0,13,0,13,0,13,0,13,0,13,0,13,0,13,0,13,0,13,0,13,0,13,12,13,0,13,0,13,0,13])

/** Source code points of BidiMirroring.txt (sorted ascending). */
const MIRROR_FROM = new Uint32Array([40,41,60,62,91,93,123,125,171,187,3898,3899,3900,3901,5787,5788,8249,8250,8261,8262,8317,8318,8333,8334,8712,8713,8714,8715,8716,8717,8725,8735,8736,8737,8738,8740,8764,8765,8771,8773,8780,8786,8787,8788,8789,8804,8805,8806,8807,8808,8809,8810,8811,8814,8815,8816,8817,8818,8819,8820,8821,8822,8823,8824,8825,8826,8827,8828,8829,8830,8831,8832,8833,8834,8835,8836,8837,8838,8839,8840,8841,8842,8843,8847,8848,8849,8850,8856,8866,8867,8870,8872,8873,8875,8880,8881,8882,8883,8884,8885,8886,8887,8888,8905,8906,8907,8908,8909,8912,8913,8918,8919,8920,8921,8922,8923,8924,8925,8926,8927,8928,8929,8930,8931,8932,8933,8934,8935,8936,8937,8938,8939,8940,8941,8944,8945,8946,8947,8948,8950,8951,8954,8955,8956,8957,8958,8968,8969,8970,8971,9001,9002,10088,10089,10090,10091,10092,10093,10094,10095,10096,10097,10098,10099,10100,10101,10179,10180,10181,10182,10184,10185,10187,10189,10197,10198,10204,10205,10206,10210,10211,10212,10213,10214,10215,10216,10217,10218,10219,10220,10221,10222,10223,10627,10628,10629,10630,10631,10632,10633,10634,10635,10636,10637,10638,10639,10640,10641,10642,10643,10644,10645,10646,10647,10648,10651,10656,10659,10660,10661,10664,10665,10666,10667,10668,10669,10670,10671,10680,10688,10689,10692,10693,10703,10704,10705,10706,10708,10709,10712,10713,10714,10715,10728,10729,10741,10744,10745,10748,10749,10795,10796,10797,10798,10804,10805,10812,10813,10852,10853,10873,10874,10875,10876,10877,10878,10879,10880,10881,10882,10883,10884,10885,10886,10887,10888,10889,10890,10891,10892,10893,10894,10895,10896,10897,10898,10899,10900,10901,10902,10903,10904,10905,10906,10907,10908,10909,10910,10911,10912,10913,10914,10918,10919,10920,10921,10922,10923,10924,10925,10927,10928,10929,10930,10931,10932,10933,10934,10935,10936,10937,10938,10939,10940,10941,10942,10943,10944,10945,10946,10947,10948,10949,10950,10951,10952,10953,10954,10955,10956,10957,10958,10959,10960,10961,10962,10963,10964,10965,10966,10974,10979,10980,10981,10988,10989,10990,10999,11000,11001,11002,11262,11778,11779,11780,11781,11785,11786,11788,11789,11804,11805,11808,11809,11810,11811,11812,11813,11814,11815,11816,11817,11861,11862,11863,11864,11865,11866,11867,11868,12296,12297,12298,12299,12300,12301,12302,12303,12304,12305,12308,12309,12310,12311,12312,12313,12314,12315,65113,65114,65115,65116,65117,65118,65124,65125,65288,65289,65308,65310,65339,65341,65371,65373,65375,65376,65378,65379])
/** Mirrored counterpart for each entry of MIRROR_FROM. */
const MIRROR_TO = new Uint32Array([41,40,62,60,93,91,125,123,187,171,3899,3898,3901,3900,5788,5787,8250,8249,8262,8261,8318,8317,8334,8333,8715,8716,8717,8712,8713,8714,10741,11262,10659,10651,10656,10990,8765,8764,8909,8780,8773,8787,8786,8789,8788,8805,8804,8807,8806,8809,8808,8811,8810,8815,8814,8817,8816,8819,8818,8821,8820,8823,8822,8825,8824,8827,8826,8829,8828,8831,8830,8833,8832,8835,8834,8837,8836,8839,8838,8841,8840,8843,8842,8848,8847,8850,8849,10680,8867,8866,10974,10980,10979,10981,8881,8880,8883,8882,8885,8884,8887,8886,10204,8906,8905,8908,8907,8771,8913,8912,8919,8918,8921,8920,8923,8922,8925,8924,8927,8926,8929,8928,8931,8930,8933,8932,8935,8934,8937,8936,8939,8938,8941,8940,8945,8944,8954,8955,8956,8957,8958,8946,8947,8948,8950,8951,8969,8968,8971,8970,9002,9001,10089,10088,10091,10090,10093,10092,10095,10094,10097,10096,10099,10098,10101,10100,10180,10179,10182,10181,10185,10184,10189,10187,10198,10197,8888,10206,10205,10211,10210,10213,10212,10215,10214,10217,10216,10219,10218,10221,10220,10223,10222,10628,10627,10630,10629,10632,10631,10634,10633,10636,10635,10640,10639,10638,10637,10642,10641,10644,10643,10646,10645,10648,10647,8737,8738,8736,10661,10660,10665,10664,10667,10666,10669,10668,10671,10670,8856,10689,10688,10693,10692,10704,10703,10706,10705,10709,10708,10713,10712,10715,10714,10729,10728,8725,10745,10744,10749,10748,10796,10795,10798,10797,10805,10804,10813,10812,10853,10852,10874,10873,10876,10875,10878,10877,10880,10879,10882,10881,10884,10883,10886,10885,10888,10887,10890,10889,10892,10891,10894,10893,10896,10895,10898,10897,10900,10899,10902,10901,10904,10903,10906,10905,10908,10907,10910,10909,10912,10911,10914,10913,10919,10918,10921,10920,10923,10922,10925,10924,10928,10927,10930,10929,10932,10931,10934,10933,10936,10935,10938,10937,10940,10939,10942,10941,10944,10943,10946,10945,10948,10947,10950,10949,10952,10951,10954,10953,10956,10955,10958,10957,10960,10959,10962,10961,10964,10963,10966,10965,8870,8873,8872,8875,10989,10988,8740,11000,10999,11002,11001,8735,11779,11778,11781,11780,11786,11785,11789,11788,11805,11804,11809,11808,11811,11810,11813,11812,11815,11814,11817,11816,11862,11861,11864,11863,11866,11865,11868,11867,12297,12296,12299,12298,12301,12300,12303,12302,12305,12304,12309,12308,12311,12310,12313,12312,12315,12314,65114,65113,65116,65115,65118,65117,65125,65124,65289,65288,65310,65308,65341,65339,65373,65371,65376,65375,65379,65378])

/** Bracket code points of BidiBrackets.txt (sorted ascending). */
const BRACKET_CP = new Uint32Array([40,41,91,93,123,125,3898,3899,3900,3901,5787,5788,8261,8262,8317,8318,8333,8334,8968,8969,8970,8971,9001,9002,10088,10089,10090,10091,10092,10093,10094,10095,10096,10097,10098,10099,10100,10101,10181,10182,10214,10215,10216,10217,10218,10219,10220,10221,10222,10223,10627,10628,10629,10630,10631,10632,10633,10634,10635,10636,10637,10638,10639,10640,10641,10642,10643,10644,10645,10646,10647,10648,10712,10713,10714,10715,10748,10749,11810,11811,11812,11813,11814,11815,11816,11817,11861,11862,11863,11864,11865,11866,11867,11868,12296,12297,12298,12299,12300,12301,12302,12303,12304,12305,12308,12309,12310,12311,12312,12313,12314,12315,65113,65114,65115,65116,65117,65118,65288,65289,65339,65341,65371,65373,65375,65376,65378,65379])
/** Paired bracket code point for each entry of BRACKET_CP. */
const BRACKET_PAIR = new Uint32Array([41,40,93,91,125,123,3899,3898,3901,3900,5788,5787,8262,8261,8318,8317,8334,8333,8969,8968,8971,8970,9002,9001,10089,10088,10091,10090,10093,10092,10095,10094,10097,10096,10099,10098,10101,10100,10182,10181,10215,10214,10217,10216,10219,10218,10221,10220,10223,10222,10628,10627,10630,10629,10632,10631,10634,10633,10636,10635,10640,10639,10638,10637,10642,10641,10644,10643,10646,10645,10648,10647,10713,10712,10715,10714,10749,10748,11811,11810,11813,11812,11815,11814,11817,11816,11862,11861,11864,11863,11866,11865,11868,11867,12297,12296,12299,12298,12301,12300,12303,12302,12305,12304,12309,12308,12311,12310,12313,12312,12315,12314,65114,65113,65116,65115,65118,65117,65289,65288,65341,65339,65373,65371,65376,65375,65379,65378])
/** Bracket type for each entry of BRACKET_CP: 1 = open, 2 = close. */
const BRACKET_TYPE = new Uint8Array([1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2])
