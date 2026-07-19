/**
 * Hangul shaper.
 *
 * Jamo handling:
 *  - <L,V> and <L,V,T> sequences compose to a precomposed syllable when the
 *    font has the glyph.
 *  - <LV,T> composes to <LVT> when possible; otherwise, and whenever the
 *    font lacks a precomposed glyph, syllables fully decompose to jamo and
 *    the ljmo / vjmo / tjmo features apply to the individual glyphs.
 *  - A tone mark (U+302E/302F) after a valid syllable is reordered to
 *    precede it, unless the tone-mark glyph is zero width (designed to
 *    overstrike). A tone mark without a valid syllable gets a dotted circle.
 * 'calt' is disabled: some CJK fonts put all jamo lookups in calt, which is
 * not desired for Hangul.
 */

import type { GsubShapingFeature } from '../parsers/tables/gsub.js'
import { GLYPH_FLAG_DEFAULT_IGNORABLE, GSUB_MASK_GLOBAL } from '../parsers/tables/gsub.js'
import { appendUserShapingFeatures, type ComplexBuffer, type ShapeContext, type ShaperFont } from './complex.js'
import { isDefaultIgnorable } from './unicode-general-category.js'
import { getUnicodeScript } from './unicode-shaping-properties.js'

const MASK_LJMO = 1 << 1
const MASK_VJMO = 1 << 2
const MASK_TJMO = 1 << 3

const JAMO_NONE = 0
const JAMO_L = 1
const JAMO_V = 2
const JAMO_T = 3

const JAMO_MASKS = [GSUB_MASK_GLOBAL, GSUB_MASK_GLOBAL | MASK_LJMO, GSUB_MASK_GLOBAL | MASK_VJMO, GSUB_MASK_GLOBAL | MASK_TJMO]

// Algorithmic syllable composition constants.
const L_BASE = 0x1100
const V_BASE = 0x1161
const T_BASE = 0x11A7
const L_COUNT = 19
const V_COUNT = 21
const T_COUNT = 28
const S_BASE = 0xAC00
const N_COUNT = V_COUNT * T_COUNT
const S_COUNT = L_COUNT * N_COUNT

function isCombiningL(u: number): boolean { return u >= L_BASE && u < L_BASE + L_COUNT }
function isCombiningV(u: number): boolean { return u >= V_BASE && u < V_BASE + V_COUNT }
function isCombiningT(u: number): boolean { return u > T_BASE && u < T_BASE + T_COUNT }
function isCombinedS(u: number): boolean { return u >= S_BASE && u < S_BASE + S_COUNT }

function isL(u: number): boolean {
  return (u >= 0x1100 && u <= 0x115F) || (u >= 0xA960 && u <= 0xA97C)
}
function isV(u: number): boolean {
  return (u >= 0x1160 && u <= 0x11A7) || (u >= 0xD7B0 && u <= 0xD7C6)
}
function isT(u: number): boolean {
  return (u >= 0x11A8 && u <= 0x11FF) || (u >= 0xD7CB && u <= 0xD7FB)
}
function isHangulTone(u: number): boolean {
  return u === 0x302E || u === 0x302F
}

/** Whether the code point participates in Hangul shaping. */
export function isHangulChar(cp: number): boolean {
  return getUnicodeScript(cp) === 'Hangul' || cp === 0x302E || cp === 0x302F
}

function hasGlyph(font: ShaperFont, cp: number): boolean {
  return font.getGlyphId(cp) !== 0
}

function isZeroWidth(font: ShaperFont, cp: number): boolean {
  const glyph = font.getGlyphId(cp)
  return glyph !== 0 && font.getAdvanceWidth(glyph) === 0
}

/**
 * Compose/decompose Hangul syllables in place and assign per-code-point jamo
 * feature classes.
 * @returns jamo class per code point (JAMO_NONE / L / V / T)
 */
export function preprocessHangul(
  font: ShaperFont,
  cps: number[],
  clusters: number[],
): number[] {
  const jamo: number[] = new Array(cps.length)
  for (let k = 0; k < cps.length; k++) jamo[k] = JAMO_NONE

  // Extent of the most recently seen valid syllable (valid when start < end).
  let start = 0
  let end = 0

  for (let i = 0; i < cps.length;) {
    const u = cps[i]!

    if (isHangulTone(u)) {
      if (start < end && end === i) {
        // Tone mark follows a valid syllable: move it in front, unless it is
        // zero width (designed to overstrike).
        if (!isZeroWidth(font, u)) {
          const cl = clusters[i]!
          cps.splice(i, 1)
          clusters.splice(i, 1)
          jamo.splice(i, 1)
          cps.splice(start, 0, u)
          clusters.splice(start, 0, cl)
          jamo.splice(start, 0, JAMO_NONE)
        }
      } else if (hasGlyph(font, 0x25CC)) {
        // No valid syllable to attach to: pair with a dotted circle.
        if (!isZeroWidth(font, u)) {
          cps.splice(i + 1, 0, 0x25CC)
          clusters.splice(i + 1, 0, 0)
          jamo.splice(i + 1, 0, JAMO_NONE)
        } else {
          cps.splice(i, 0, 0x25CC)
          clusters.splice(i, 0, 0)
          jamo.splice(i, 0, JAMO_NONE)
        }
        i++
      }
      i++
      start = end = i
      continue
    }

    start = i

    if (isL(u) && i + 1 < cps.length) {
      const l = u
      const v = cps[i + 1]!
      if (isV(v)) {
        // <L,V> or <L,V,T>.
        let t = 0
        let tindex = 0
        if (i + 2 < cps.length) {
          t = cps[i + 2]!
          if (isT(t)) tindex = t - T_BASE
          else t = 0
        }
        if (isCombiningL(l) && isCombiningV(v) && (t === 0 || isCombiningT(t))) {
          const s = S_BASE + (l - L_BASE) * N_COUNT + (v - V_BASE) * T_COUNT + tindex
          if (hasGlyph(font, s)) {
            const count = t !== 0 ? 3 : 2
            let cl = 0
            for (let k = 0; k < count; k++) cl += clusters[i + k]!
            cps.splice(i, count, s)
            clusters.splice(i, count, cl)
            jamo.splice(i, count, JAMO_NONE)
            end = start + 1
            i = end
            continue
          }
        }
        // Not composed: tag the jamo features and advance past them.
        jamo[i] = JAMO_L
        jamo[i + 1] = JAMO_V
        if (t !== 0) {
          jamo[i + 2] = JAMO_T
          end = start + 3
        } else {
          end = start + 2
        }
        i = end
        continue
      }
    } else if (isCombinedS(u)) {
      // <LV>, <LVT> or <LV,T>.
      const s = u
      const sHasGlyph = hasGlyph(font, s)
      const lindex = Math.floor((s - S_BASE) / N_COUNT)
      const nindex = (s - S_BASE) % N_COUNT
      const vindex = Math.floor(nindex / T_COUNT)
      const tindex = nindex % T_COUNT

      if (tindex === 0 && i + 1 < cps.length && isCombiningT(cps[i + 1]!)) {
        // <LV,T>: try to combine.
        const newS = s + (cps[i + 1]! - T_BASE)
        if (hasGlyph(font, newS)) {
          const cl = clusters[i]! + clusters[i + 1]!
          cps.splice(i, 2, newS)
          clusters.splice(i, 2, cl)
          jamo.splice(i, 2, JAMO_NONE)
          end = start + 1
          i = end
          continue
        }
      }

      // Decompose when the font lacks the precomposed glyph, or for a
      // non-combining T after an <LV>.
      const followedByNonCombiningT = tindex === 0 && i + 1 < cps.length && isT(cps[i + 1]!)
      if (!sHasGlyph || followedByNonCombiningT) {
        const dl = L_BASE + lindex
        const dv = V_BASE + vindex
        const dt = tindex !== 0 ? T_BASE + tindex : 0
        if (hasGlyph(font, dl) && hasGlyph(font, dv) && (dt === 0 || hasGlyph(font, dt))) {
          if (dt !== 0) {
            cps.splice(i, 1, dl, dv, dt)
            clusters.splice(i, 1, clusters[i]!, 0, 0)
            jamo.splice(i, 1, JAMO_L, JAMO_V, JAMO_T)
            end = start + 3
          } else {
            cps.splice(i, 1, dl, dv)
            clusters.splice(i, 1, clusters[i]!, 0)
            jamo.splice(i, 1, JAMO_L, JAMO_V)
            end = start + 2
          }
          // A decomposition triggered by a following non-combining T pulls
          // that T into the syllable.
          if (sHasGlyph && tindex === 0 && end < cps.length && isT(cps[end]!)) {
            jamo[end] = JAMO_T
            end++
          }
          i = end
          continue
        }
      }

      if (sHasGlyph) {
        end = start + 1
        i = end
        continue
      }
    }

    // Not a recognizable syllable; leave end <= start so tone marks do not
    // reorder around it.
    i++
  }

  return jamo
}

const HANGUL_FEATURES: GsubShapingFeature[] = [
  { tag: 'locl', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'ccmp', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'ljmo', mask: MASK_LJMO, perSyllable: false },
  { tag: 'vjmo', mask: MASK_VJMO, perSyllable: false },
  { tag: 'tjmo', mask: MASK_TJMO, perSyllable: false },
  { tag: 'rlig', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'liga', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'clig', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'rclt', mask: GSUB_MASK_GLOBAL, perSyllable: false },
]

/** calt is deliberately excluded (disabled for Hangul). */
const HANGUL_BUILTIN_TAGS = new Set([
  'locl', 'ccmp', 'ljmo', 'vjmo', 'tjmo', 'rlig', 'liga', 'clig', 'rclt', 'calt',
])

/**
 * Shape a Hangul code point sequence into glyphs.
 * @returns glyph ids with per-glyph source cluster counts
 */
export function shapeHangul(
  ctx: ShapeContext,
  cps: number[],
  charClusters: number[] | null,
  charSourceClusters: number[] | null = null,
): { glyphIds: number[], clusters: number[], sourceClusters: number[], flags: number[] } {
  const clusters = charClusters ?? new Array<number>(cps.length)
  if (charClusters === null) {
    for (let i = 0; i < cps.length; i++) clusters[i] = 1
  }

  const jamo = preprocessHangul(ctx.font, cps, clusters)
  const sourceClusters = new Array<number>(cps.length)
  let sourceCursor = 0
  for (let i = 0; i < cps.length; i++) {
    sourceClusters[i] = charSourceClusters?.[sourceCursor] ?? sourceCursor
    sourceCursor += clusters[i]!
  }

  const n = cps.length
  const buf: ComplexBuffer = {
    glyphs: new Array<number>(n),
    masks: new Array<number>(n),
    clusters,
    sourceClusters,
    syllables: new Array<number>(n),
    aux: new Array<number>(n),
    flags: new Array<number>(n),
  }
  for (let i = 0; i < n; i++) {
    buf.glyphs[i] = ctx.font.getGlyphId(cps[i]!)
    buf.masks[i] = JAMO_MASKS[jamo[i]!]!
    buf.syllables[i] = 0
    buf.aux[i] = 0
    buf.flags[i] = isDefaultIgnorable(cps[i]!) ? GLYPH_FLAG_DEFAULT_IGNORABLE : 0
  }

  const features = appendUserShapingFeatures(HANGUL_FEATURES, HANGUL_BUILTIN_TAGS, ctx)
  ctx.gsub.applyShapingFeatures(buf, features, ctx.script ?? 'hang', ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  return { glyphIds: buf.glyphs, clusters: buf.clusters, sourceClusters: buf.sourceClusters, flags: buf.flags }
}
