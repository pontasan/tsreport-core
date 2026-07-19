/**
 * Shared infrastructure for the complex-script shapers (Indic, Khmer,
 * Myanmar, Hangul): the shaping buffer with its parallel per-glyph arrays,
 * buffer construction from code points, and the reordering helpers.
 *
 * Buffer layout: glyphs / masks / clusters / syllables / flags follow the
 * GSUB shaping-buffer contract (gsub.ts). aux packs the shaper-assigned
 * classification: category (bits 0..7), visual position (bits 8..15), and
 * an "initial-form blocker" bit (bit 16) set when the preceding source
 * character is a letter, mark or format character.
 */

import type { GsubLookupModifications, GsubShapingFeature, GsubTable, OpenTypeFeatureSetting } from '../parsers/tables/gsub.js'
import type { GdefTable } from '../parsers/tables/gdef.js'
import { GLYPH_FLAG_DEFAULT_IGNORABLE, GSUB_MASK_GLOBAL } from '../parsers/tables/gsub.js'
import { getShapingClass } from './ot-categories.js'
import { INIT_BLOCKER_RANGES } from './unicode-tables.js'
import { scanLongest, type SyllableScanner } from './syllable-machine.js'
import { isDefaultIgnorable } from './unicode-general-category.js'

/** Complex script classes detected by Font.shapeText() dispatch. */
export type ComplexScriptClass = 0 | 1 | 2 | 3 | 4 | 5 | 6
export const COMPLEX_NONE: ComplexScriptClass = 0
export const COMPLEX_INDIC: ComplexScriptClass = 1
export const COMPLEX_KHMER: ComplexScriptClass = 2
export const COMPLEX_MYANMAR: ComplexScriptClass = 3
export const COMPLEX_HANGUL: ComplexScriptClass = 4
export const COMPLEX_TIBETAN: ComplexScriptClass = 5
export const COMPLEX_USE: ComplexScriptClass = 6

/** Font services the shapers need (satisfied by Font). */
export interface ShaperFont {
  getGlyphId(codePoint: number): number
  getGlyphIdWithVariation(codePoint: number, variationSelector: number): number
  getAdvanceWidth(glyphId: number): number
}

/** Complex shaping buffer: all parallel arrays are always present. */
export interface ComplexBuffer {
  glyphs: number[]
  masks: number[]
  clusters: number[]
  sourceClusters: number[]
  syllables: number[]
  aux: number[]
  flags: number[]
}

/** GSUB shaping context passed down from Font.shapeText(). */
export interface ShapeContext {
  font: ShaperFont
  gsub: GsubTable
  gdef: GdefTable | null
  script: string | null
  language: string | null
  userFeatures: Set<string> | null
  featureSettings: readonly OpenTypeFeatureSetting[] | null
  normalizedCoords: number[] | null
  jstfLookupModifications?: GsubLookupModifications | null
}

/** Add caller-requested features to the final complex-shaping stage. */
export function appendUserShapingFeatures(
  base: readonly GsubShapingFeature[],
  builtinTags: ReadonlySet<string>,
  ctx: ShapeContext,
): readonly GsubShapingFeature[] {
  const extra: GsubShapingFeature[] = []
  const added = new Set<string>()
  if (ctx.userFeatures !== null) {
    for (const tag of ctx.userFeatures) {
      if (!builtinTags.has(tag)) {
        extra.push({ tag, mask: GSUB_MASK_GLOBAL, perSyllable: false })
        added.add(tag)
      }
    }
  }
  if (ctx.featureSettings !== null) {
    for (let i = 0; i < ctx.featureSettings.length; i++) {
      const tag = ctx.featureSettings[i]!.tag
      if (!builtinTags.has(tag) && !added.has(tag)) {
        extra.push({ tag, mask: GSUB_MASK_GLOBAL, perSyllable: false, defaultValue: 0 })
        added.add(tag)
      }
    }
  }
  return extra.length === 0 ? base : [...base, ...extra]
}

export function auxCategory(aux: number): number {
  return aux & 0xFF
}

export function auxPosition(aux: number): number {
  return (aux >> 8) & 0xFF
}

export function auxWithPosition(aux: number, pos: number): number {
  return (aux & ~0xFF00) | (pos << 8)
}

export function auxWithCategory(aux: number, cat: number): number {
  return (aux & ~0xFF) | cat
}

/** aux bit 16: the preceding source character blocks word-initial forms. */
export const AUX_INIT_BLOCKED = 1 << 16

const INIT_BLOCKER_COUNT = INIT_BLOCKER_RANGES.length / 2

/** Whether the code point blocks a following word-initial form (Cf, Cn, Co, Cs, letters, marks). */
export function isInitBlocker(cp: number): boolean {
  let lo = 0
  let hi = INIT_BLOCKER_COUNT - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const base = mid * 2
    if (cp < INIT_BLOCKER_RANGES[base]!) {
      hi = mid - 1
    } else if (cp > INIT_BLOCKER_RANGES[base + 1]!) {
      lo = mid + 1
    } else {
      return true
    }
  }
  return false
}

/** Unicode variation selectors (VS1-16, VS17-256, Mongolian FVS). */
function isVariationSelectorCp(cp: number): boolean {
  // Mongolian FVS (180B-180D, 180F) are NOT folded through cmap format 14:
  // they stay in the glyph stream so the font's GSUB contexts (and the USE
  // cluster grammar) can see them, matching hb-shape behavior.
  return (cp >= 0xFE00 && cp <= 0xFE0F) ||
         (cp >= 0xE0100 && cp <= 0xE01EF)
}

/**
 * Build the shaping buffer from code points: map to glyphs (folding
 * variation-selector sequences the cmap resolves), classify each character,
 * and initialize masks (global bit), clusters and flags.
 */
export function buildComplexBuffer(
  font: ShaperFont,
  cps: number[],
  charClusters: number[] | null,
  charSourceClusters: number[] | null,
  classify?: (cp: number) => number,
): ComplexBuffer {
  const glyphs: number[] = []
  const masks: number[] = []
  const clusters: number[] = []
  const sourceClusters: number[] = []
  const syllables: number[] = []
  const aux: number[] = []
  const flags: number[] = []

  let prevBlocks = false
  for (let k = 0; k < cps.length; k++) {
    const cp = cps[k]!
    const next = k + 1 < cps.length ? cps[k + 1]! : -1
    let glyph: number
    let cluster = charClusters !== null ? charClusters[k]! : 1
    if (isVariationSelectorCp(next)) {
      const variant = font.getGlyphIdWithVariation(cp, next)
      if (variant !== 0) {
        // The cmap resolves the sequence: fold the selector into the base.
        glyph = variant
        cluster += charClusters !== null ? charClusters[k + 1]! : 1
        k++
      } else {
        glyph = font.getGlyphId(cp)
      }
    } else {
      glyph = font.getGlyphId(cp)
    }
    glyphs.push(glyph)
    masks.push(GSUB_MASK_GLOBAL)
    clusters.push(cluster)
    sourceClusters.push(charSourceClusters?.[k] ?? k)
    syllables.push(0)
    aux.push((classify !== undefined ? classify(cp) : getShapingClass(cp)) | (prevBlocks ? AUX_INIT_BLOCKED : 0))
    flags.push(isDefaultIgnorable(cp) ? GLYPH_FLAG_DEFAULT_IGNORABLE : 0)
    prevBlocks = isInitBlocker(cp)
  }

  return { glyphs, masks, clusters, sourceClusters, syllables, aux, flags }
}

/**
 * Assign syllable serials/types over the buffer with the given scanner:
 * syllables[i] = (serial << 4) | type. Positions where the scanner matches
 * nothing become one-character syllables of nonTokenType.
 * @returns true when any syllable of brokenType was found
 */
export function findSyllables(
  buf: ComplexBuffer,
  scanner: SyllableScanner,
  brokenType: number,
  nonTokenType: number,
): boolean {
  const n = buf.glyphs.length
  const cats: number[] = new Array(n)
  for (let i = 0; i < n; i++) cats[i] = auxCategory(buf.aux[i]!)
  let serial = 1
  let hasBroken = false
  let i = 0
  while (i < n) {
    const m = scanLongest(scanner, cats, i, n)
    const len = m === 0 ? 1 : m >> 8
    const type = m === 0 ? nonTokenType : m & 0xFF
    if (type === brokenType) hasBroken = true
    const value = (serial << 4) | type
    for (let k = 0; k < len; k++) buf.syllables[i + k] = value
    serial++
    i += len
  }
  return hasBroken
}

/**
 * Merge the source-count clusters of buffer range [start, end): the first
 * slot receives the sum, the rest become continuations (0). Keeps the
 * per-glyph counts summing to the source code point count across reorders.
 */
export function mergeClusters(buf: ComplexBuffer, start: number, end: number): void {
  if (end - start < 2) return
  let sum = 0
  for (let i = start; i < end; i++) {
    sum += buf.clusters[i]!
    buf.clusters[i] = 0
  }
  buf.clusters[start] = sum
}

/**
 * Move the glyph at `from` to position `to` (to <= from), shifting the range
 * between them one slot toward the end. All parallel arrays move together.
 */
export function moveGlyphBack(buf: ComplexBuffer, from: number, to: number): void {
  const glyph = buf.glyphs[from]!
  const mask = buf.masks[from]!
  const cluster = buf.clusters[from]!
  const sourceCluster = buf.sourceClusters[from]!
  const syllable = buf.syllables[from]!
  const auxV = buf.aux[from]!
  const flag = buf.flags[from]!
  for (let j = from; j > to; j--) {
    buf.glyphs[j] = buf.glyphs[j - 1]!
    buf.masks[j] = buf.masks[j - 1]!
    buf.clusters[j] = buf.clusters[j - 1]!
    buf.sourceClusters[j] = buf.sourceClusters[j - 1]!
    buf.syllables[j] = buf.syllables[j - 1]!
    buf.aux[j] = buf.aux[j - 1]!
    buf.flags[j] = buf.flags[j - 1]!
  }
  buf.glyphs[to] = glyph
  buf.masks[to] = mask
  buf.clusters[to] = cluster
  buf.sourceClusters[to] = sourceCluster
  buf.syllables[to] = syllable
  buf.aux[to] = auxV
  buf.flags[to] = flag
}

/**
 * Move the glyph at `from` to position `to` (to >= from), shifting the range
 * between them one slot toward the start.
 */
export function moveGlyphForward(buf: ComplexBuffer, from: number, to: number): void {
  const glyph = buf.glyphs[from]!
  const mask = buf.masks[from]!
  const cluster = buf.clusters[from]!
  const sourceCluster = buf.sourceClusters[from]!
  const syllable = buf.syllables[from]!
  const auxV = buf.aux[from]!
  const flag = buf.flags[from]!
  for (let j = from; j < to; j++) {
    buf.glyphs[j] = buf.glyphs[j + 1]!
    buf.masks[j] = buf.masks[j + 1]!
    buf.clusters[j] = buf.clusters[j + 1]!
    buf.sourceClusters[j] = buf.sourceClusters[j + 1]!
    buf.syllables[j] = buf.syllables[j + 1]!
    buf.aux[j] = buf.aux[j + 1]!
    buf.flags[j] = buf.flags[j + 1]!
  }
  buf.glyphs[to] = glyph
  buf.masks[to] = mask
  buf.clusters[to] = cluster
  buf.sourceClusters[to] = sourceCluster
  buf.syllables[to] = syllable
  buf.aux[to] = auxV
  buf.flags[to] = flag
}

/** Reverse buffer range [start, end) (all parallel arrays). */
export function reverseRange(buf: ComplexBuffer, start: number, end: number): void {
  for (let i = start, j = end - 1; i < j; i++, j--) {
    swapGlyphs(buf, i, j)
  }
}

function swapGlyphs(buf: ComplexBuffer, i: number, j: number): void {
  let t: number
  t = buf.glyphs[i]!; buf.glyphs[i] = buf.glyphs[j]!; buf.glyphs[j] = t
  t = buf.masks[i]!; buf.masks[i] = buf.masks[j]!; buf.masks[j] = t
  t = buf.clusters[i]!; buf.clusters[i] = buf.clusters[j]!; buf.clusters[j] = t
  t = buf.sourceClusters[i]!; buf.sourceClusters[i] = buf.sourceClusters[j]!; buf.sourceClusters[j] = t
  t = buf.syllables[i]!; buf.syllables[i] = buf.syllables[j]!; buf.syllables[j] = t
  t = buf.aux[i]!; buf.aux[i] = buf.aux[j]!; buf.aux[j] = t
  t = buf.flags[i]!; buf.flags[i] = buf.flags[j]!; buf.flags[j] = t
}

/**
 * Stable sort of buffer range [start, end) by ascending aux position
 * (insertion sort; syllables are short and mostly ordered).
 */
export function sortByPosition(buf: ComplexBuffer, start: number, end: number): boolean {
  let moved = false
  for (let i = start + 1; i < end; i++) {
    const pos = auxPosition(buf.aux[i]!)
    let j = i
    while (j > start && auxPosition(buf.aux[j - 1]!) > pos) j--
    if (j < i) {
      moveGlyphBack(buf, i, j)
      moved = true
    }
  }
  return moved
}

/**
 * Insert a glyph at `at` (all parallel arrays). Used for dotted-circle
 * insertion on broken clusters.
 */
export function insertGlyph(
  buf: ComplexBuffer,
  at: number,
  glyph: number,
  mask: number,
  cluster: number,
  syllable: number,
  auxV: number,
): void {
  buf.glyphs.splice(at, 0, glyph)
  buf.masks.splice(at, 0, mask)
  buf.clusters.splice(at, 0, cluster)
  const sourceCluster = at < buf.sourceClusters.length
    ? buf.sourceClusters[at]!
    : (buf.sourceClusters[at - 1] ?? 0)
  buf.sourceClusters.splice(at, 0, sourceCluster)
  buf.syllables.splice(at, 0, syllable)
  buf.aux.splice(at, 0, auxV)
  buf.flags.splice(at, 0, 0)
}
