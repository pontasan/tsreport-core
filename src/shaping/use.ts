/**
 * Universal Shaping Engine (USE) shaper.
 *
 * Covers the scripts without a dedicated shaper (Javanese, Balinese,
 * Sundanese, Cham, Tai Tham, Buginese, Batak, Lepcha, Kayah Li, Rejang,
 * Tai Viet, Meetei Mayek, Mongolian, ...). Pipeline per the USE spec:
 *  1. classify (use-tables) and segment into clusters (syllable machine)
 *  2. basic substitution: locl/ccmp/nukt/akhn, then rphf and pref with
 *     substitution recording (would-substitute probes)
 *  3. orthographic features: rkrf/abvf/blwf/half/pstf/vatu/cjct
 *  4. reorder: substituted repha moves before the first post-base glyph;
 *     pre-base vowels (VPre/VMPre) and substituted pref move to just after
 *     the last halant (or the cluster start)
 *  5. topographical isol/init/medi/fina per cluster adjacency (drives the
 *     Mongolian joining forms)
 *  6. typographic presentation features
 */

import type { GsubShapingFeature } from '../parsers/tables/gsub.js'
import { GSUB_MASK_GLOBAL } from '../parsers/tables/gsub.js'
import {
  type ComplexBuffer, type ShapeContext,
  auxCategory, buildComplexBuffer, findSyllables, mergeClusters, moveGlyphBack, insertGlyph,
  appendUserShapingFeatures,
} from './complex.js'
import { SyllableGrammar, type SyllableScanner } from './syllable-machine.js'
import { reorderMarkRuns } from './normalize.js'
import {
  getUseClass,
  U_B, U_N, U_GB, U_SUB, U_H, U_HN, U_ZWNJ, U_ZWJ, U_VS, U_R, U_CS, U_HVM, U_SK, U_IS,
  U_IND, U_S, U_WJ, U_O,
  U_FABV, U_FBLW, U_FPST, U_MABV, U_MBLW, U_MPST, U_MPRE, U_CMABV, U_CMBLW,
  U_VABV, U_VBLW, U_VPST, U_VPRE, U_VMABV, U_VMBLW, U_VMPST, U_VMPRE,
  U_SMABV, U_SMBLW, U_FMABV, U_FMBLW, U_FMPST, U_DC,
  U_RK, U_G, U_J, U_SB, U_SE, U_HM, U_HR,
} from './use-tables.js'

export { isUseScriptChar } from './use-tables.js'

// --- Feature masks ---

const MASK_RPHF = 1 << 1
const MASK_PREF = 1 << 2
const MASK_ISOL = 1 << 3
const MASK_INIT = 1 << 4
const MASK_MEDI = 1 << 5
const MASK_FINA = 1 << 6
const MASK_TOPO = MASK_ISOL | MASK_INIT | MASK_MEDI | MASK_FINA

// --- Syllable types ---

const SYL_INDEPENDENT = 1
const SYL_VIRAMA_TERM = 2
const SYL_SAKOT_TERM = 3
const SYL_STANDARD = 4
const SYL_NUMBER_JOINER = 5
const SYL_NUMERAL = 6
const SYL_SYMBOL = 7
const SYL_BROKEN = 8
const SYL_HIEROGLYPH = 9
const SYL_NON_USE = 10

// --- Cluster grammar (USE specification, HarfBuzz use machine) ---

function buildUseScanner(): SyllableScanner {
  const g = new SyllableGrammar()

  const h = () => g.cat([U_H, U_HVM, U_IS, U_SK])
  const vs = () => g.opt(g.cat([U_VS]))
  const consonantModifiers = () => g.seq(
    g.star(g.cat([U_CMABV])), g.star(g.cat([U_CMBLW])),
    g.star(g.seq(
      g.alt(g.seq(h(), g.cat([U_B])), g.cat([U_SUB])),
      vs(), g.star(g.cat([U_CMABV])), g.star(g.cat([U_CMBLW])),
    )),
  )
  const medialConsonants = () => g.seq(
    g.opt(g.cat([U_MPRE])), g.opt(g.cat([U_MABV])), g.opt(g.cat([U_MBLW])), g.opt(g.cat([U_MPST])),
  )
  const dependentVowels = () => g.alt(
    g.seq(
      g.star(g.cat([U_VPRE])), g.star(g.cat([U_VABV])), g.star(g.cat([U_VBLW])), g.star(g.cat([U_VPST])),
    ),
    h(),
  )
  const vowelModifiers = () => g.seq(
    g.opt(g.cat([U_HVM])),
    g.star(g.cat([U_VMPRE])), g.star(g.cat([U_VMABV])), g.star(g.cat([U_VMBLW])), g.star(g.cat([U_VMPST])),
  )
  const finalConsonants = () => g.seq(
    g.star(g.cat([U_FABV])), g.star(g.cat([U_FBLW])), g.star(g.cat([U_FPST])),
  )
  const finalModifiers = () => g.alt(
    g.seq(g.star(g.cat([U_FMABV])), g.star(g.cat([U_FMBLW]))),
    g.opt(g.cat([U_FMPST])),
  )
  const complexSyllableStart = () => g.seq(
    g.opt(g.cat([U_R, U_CS])), g.cat([U_B, U_GB]), vs(),
  )
  const complexSyllableMiddle = () => g.seq(
    consonantModifiers(),
    medialConsonants(),
    dependentVowels(),
    vowelModifiers(),
    g.star(g.seq(g.cat([U_SK]), g.cat([U_B]))),
  )
  const complexSyllableTail = () => g.seq(
    complexSyllableMiddle(), finalConsonants(), finalModifiers(),
  )
  const numberJoinerTail = () => g.seq(
    g.star(g.seq(g.cat([U_HN]), g.cat([U_N]), vs())), g.cat([U_HN]),
  )
  const numeralTail = () => g.seq(
    g.seq(g.cat([U_HN]), g.cat([U_N]), vs()),
    g.star(g.seq(g.cat([U_HN]), g.cat([U_N]), vs())),
  )
  const symbolTail = () => g.alt(
    g.seq(g.cat([U_SMABV]), g.star(g.cat([U_SMABV])), g.star(g.cat([U_SMBLW]))),
    g.seq(g.cat([U_SMBLW]), g.star(g.cat([U_SMBLW]))),
  )
  const sakotTail = () => g.seq(complexSyllableMiddle(), g.cat([U_SK]))
  const viramaTail = () => g.seq(consonantModifiers(), g.cat([U_IS, U_RK]))
  // hb `tail`: any of the cluster tails a base/symbol run may carry.
  const tail = () => g.alt(complexSyllableTail(), sakotTail(), symbolTail(), viramaTail())

  // Order encodes priority (longest match first; ties by registration).
  g.token(g.seq(complexSyllableStart(), consonantModifiers(), g.cat([U_IS])), SYL_VIRAMA_TERM)
  g.token(g.seq(complexSyllableStart(), complexSyllableMiddle(), g.cat([U_SK])), SYL_SAKOT_TERM)
  g.token(g.seq(complexSyllableStart(), complexSyllableTail()), SYL_STANDARD)
  g.token(g.seq(g.cat([U_N]), vs(), g.star(g.seq(g.cat([U_HN]), g.cat([U_N]), vs())), g.cat([U_HN])), SYL_NUMBER_JOINER)
  g.token(g.seq(g.cat([U_N]), vs(), g.star(g.seq(g.cat([U_HN]), g.cat([U_N]), vs()))), SYL_NUMERAL)
  // hb `symbol_cluster = (O | GB | SB) tail?` — a symbol/other base may carry a
  // full cluster tail (so e.g. an O followed by a matra is a symbol cluster,
  // not a broken one).
  g.token(g.seq(g.cat([U_S, U_GB, U_O, U_SB]), g.opt(tail())), SYL_SYMBOL)
  const hieroglyph = () => g.seq(
    g.star(g.cat([U_SB])), g.cat([U_G]), g.opt(g.cat([U_HR])), g.opt(g.cat([U_HM])), g.star(g.cat([U_SE])),
  )
  g.token(g.seq(
    hieroglyph(),
    g.star(g.seq(g.cat([U_J]), g.opt(hieroglyph()))),
  ), SYL_HIEROGLYPH)
  // hb `broken_cluster = R? (tail | number_joiner_tail | numeral_tail)`.
  g.token(g.seq(
    g.opt(g.cat([U_R])),
    g.alt(tail(), numberJoinerTail(), numeralTail()),
  ), SYL_BROKEN)
  g.token(g.seq(g.cat([U_IND, U_O, U_WJ]), vs()), SYL_INDEPENDENT)

  return g.build()
}

const USE_SCANNER = buildUseScanner()

// --- Reordering (hb reorder_syllable_use) ---

const POST_BASE_CATS = new Set([
  U_FABV, U_FBLW, U_FPST, U_MABV, U_MBLW, U_MPST, U_MPRE,
  U_VABV, U_VBLW, U_VPST, U_VPRE, U_VMABV, U_VMBLW, U_VMPST, U_VMPRE,
])

function isHalantCat(cat: number): boolean {
  return cat === U_H || cat === U_IS || cat === U_HVM
}

function reorderSyllableUse(buf: ComplexBuffer, start: number, end: number, prefFlags: boolean[]): void {
  const type = buf.syllables[start]! & 0x0F
  if (type !== SYL_VIRAMA_TERM && type !== SYL_SAKOT_TERM && type !== SYL_STANDARD && type !== SYL_BROKEN) return

  // Move a substituted repha towards the end, but before the first
  // post-base glyph (rphf-substitution recorded via the RPHF mask probe).
  if (auxCategory(buf.aux[start]!) === U_R && end - start > 1 && prefFlags[start] === true) {
    for (let i = start + 1; i < end; i++) {
      const cat = auxCategory(buf.aux[i]!)
      const isPostBase = POST_BASE_CATS.has(cat) || isHalantCat(cat)
      if (isPostBase || i === end - 1) {
        let target = i
        if (isPostBase) target--
        if (target > start) {
          mergeClusters(buf, start, target + 1)
          // Move the repha glyph forward to `target`.
          const glyph = buf.glyphs[start]!
          const mask = buf.masks[start]!
          const cluster = buf.clusters[start]!
          const aux = buf.aux[start]!
          const flag = buf.flags[start]!
          const syllable = buf.syllables[start]!
          for (let j = start; j < target; j++) {
            buf.glyphs[j] = buf.glyphs[j + 1]!
            buf.masks[j] = buf.masks[j + 1]!
            buf.clusters[j] = buf.clusters[j + 1]!
            buf.aux[j] = buf.aux[j + 1]!
            buf.flags[j] = buf.flags[j + 1]!
            buf.syllables[j] = buf.syllables[j + 1]!
          }
          buf.glyphs[target] = glyph
          buf.masks[target] = mask
          buf.clusters[target] = cluster
          buf.aux[target] = aux
          buf.flags[target] = flag
          buf.syllables[target] = syllable
        }
        break
      }
    }
  }

  // Move pre-base glyphs (VPre / VMPre / substituted pref) back: to just
  // after the last halant before them, or to the cluster start. A halant
  // consumed by a ligature (cluster count > 1) no longer acts as one.
  let j = start
  for (let i = start; i < end; i++) {
    const cat = auxCategory(buf.aux[i]!)
    if (isHalantCat(cat) && buf.clusters[i]! <= 1) {
      j = i + 1
    } else if ((cat === U_VPRE || cat === U_VMPRE || prefFlags[i] === true) && j < i) {
      mergeClusters(buf, j, i + 1)
      moveGlyphBack(buf, i, j)
    }
  }
}

// --- Feature stages ---

const USE_PREPROCESS_STAGE: GsubShapingFeature[] = [
  { tag: 'locl', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'ccmp', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'nukt', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'akhn', mask: GSUB_MASK_GLOBAL, perSyllable: true },
]

const USE_RPHF_STAGE: GsubShapingFeature[] = [
  { tag: 'rphf', mask: MASK_RPHF, perSyllable: true },
]

const USE_PREF_STAGE: GsubShapingFeature[] = [
  { tag: 'pref', mask: MASK_PREF, perSyllable: true },
]

const USE_BASIC_STAGE: GsubShapingFeature[] = [
  { tag: 'rkrf', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'abvf', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'blwf', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'half', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'pstf', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'vatu', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'cjct', mask: GSUB_MASK_GLOBAL, perSyllable: true },
]

const USE_TOPO_STAGE: GsubShapingFeature[] = [
  { tag: 'isol', mask: MASK_ISOL, perSyllable: false },
  { tag: 'init', mask: MASK_INIT, perSyllable: false },
  { tag: 'medi', mask: MASK_MEDI, perSyllable: false },
  { tag: 'fina', mask: MASK_FINA, perSyllable: false },
]

const USE_FINAL_FEATURES: GsubShapingFeature[] = [
  { tag: 'abvs', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'blws', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'haln', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'pres', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'psts', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'rlig', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'calt', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'clig', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'liga', mask: GSUB_MASK_GLOBAL, perSyllable: false },
  { tag: 'rclt', mask: GSUB_MASK_GLOBAL, perSyllable: false },
]

const USE_BUILTIN_TAGS = new Set([
  'locl', 'ccmp', 'nukt', 'akhn', 'rphf', 'pref', 'rkrf', 'abvf', 'blwf',
  'half', 'pstf', 'vatu', 'cjct', 'isol', 'init', 'medi', 'fina',
  'abvs', 'blws', 'haln', 'pres', 'psts', 'rlig', 'calt', 'clig', 'liga', 'rclt',
])

// --- Topographical joining (drives Mongolian forms) ---

function setupTopographicalMasks(buf: ComplexBuffer): void {
  let lastStart = -1
  let lastEnd = -1
  let lastForm = 0  // 0 none, 1 isol, 2 fina (final decision pending), 3 init, 4 medi
  for (let start = 0; start < buf.glyphs.length;) {
    let end = start + 1
    while (end < buf.glyphs.length && buf.syllables[end] === buf.syllables[start]) end++
    const type = buf.syllables[start]! & 0x0F
    if (type === SYL_INDEPENDENT || type === SYL_SYMBOL || type === SYL_NON_USE) {
      lastForm = 0
      start = end
      continue
    }
    const join = lastForm === 1 || lastForm === 2
    let mask: number
    if (join) {
      // Fix up the previous cluster: isol -> init, fina -> medi
      const promoted = lastForm === 1 ? MASK_INIT : MASK_MEDI
      for (let i = lastStart; i < lastEnd; i++) {
        buf.masks[i] = (buf.masks[i]! & ~MASK_TOPO) | promoted
      }
      mask = MASK_FINA
      lastForm = 2
    } else {
      mask = MASK_ISOL
      lastForm = 1
    }
    for (let i = start; i < end; i++) {
      buf.masks[i] = (buf.masks[i]! & ~MASK_TOPO) | mask
    }
    lastStart = start
    lastEnd = end
    start = end
  }
}

// --- Shaper entry point ---

/**
 * Shape a USE-script code point sequence into glyphs.
 * @returns glyph ids with per-glyph source cluster counts
 */
export function shapeUse(
  ctx: ShapeContext,
  cps: number[],
  charClusters: number[] | null,
  charSourceClusters: number[] | null = null,
): { glyphIds: number[], clusters: number[], sourceClusters: number[], flags: number[] } {
  const clusters = charClusters ?? new Array<number>(cps.length)
  if (charClusters === null) {
    for (let i = 0; i < cps.length; i++) clusters[i] = 1
  }
  const sourceClusters = charSourceClusters ?? cps.map((_cp, index) => index)
  reorderMarkRuns(cps, clusters, sourceClusters)

  const scriptTag = ctx.script ?? null
  const buf = buildComplexBuffer(ctx.font, cps, clusters, sourceClusters, getUseClass)
  const hasBroken = findSyllables(buf, USE_SCANNER, SYL_BROKEN, SYL_NON_USE)

  // Insert dotted circles into broken clusters.
  if (hasBroken) {
    const dcGlyph = ctx.font.getGlyphId(0x25CC)
    if (dcGlyph !== 0) {
      let lastSyllable = -1
      for (let i = 0; i < buf.glyphs.length; i++) {
        const syllable = buf.syllables[i]!
        if (syllable !== lastSyllable && (syllable & 0x0F) === SYL_BROKEN) {
          // After an initial repha, otherwise at the cluster start.
          let at = i
          if (auxCategory(buf.aux[i]!) === U_R && i + 1 < buf.glyphs.length && buf.syllables[i + 1] === syllable) at = i + 1
          insertGlyph(buf, at, dcGlyph, buf.masks[i]!, 0, syllable, U_DC)
          i = at
        }
        lastSyllable = syllable
      }
    }
  }

  // Record which glyphs the rphf / pref features would substitute — the
  // reordering decisions depend on it (hb records post-substitution flags;
  // the zero-context would-substitute probe makes the same decision).
  const gsub = ctx.gsub
  const prefFlags: boolean[] = new Array<boolean>(buf.glyphs.length).fill(false)
  const rphfLookups = gsub.getFeatureLookupIndexList('rphf', scriptTag, ctx.language, ctx.normalizedCoords)
  const prefLookups = gsub.getFeatureLookupIndexList('pref', scriptTag, ctx.language, ctx.normalizedCoords)
  for (let start = 0; start < buf.glyphs.length;) {
    let end = start + 1
    while (end < buf.glyphs.length && buf.syllables[end] === buf.syllables[start]) end++
    if (auxCategory(buf.aux[start]!) === U_R && rphfLookups.length > 0) {
      const one = [buf.glyphs[start]!]
      const two = end - start > 1 ? [buf.glyphs[start]!, buf.glyphs[start + 1]!] : one
      if (gsub.wouldSubstitute(rphfLookups, one, true) || gsub.wouldSubstitute(rphfLookups, two, true)) {
        prefFlags[start] = true
        buf.masks[start] = buf.masks[start]! | MASK_RPHF
        if (two.length === 2 && !gsub.wouldSubstitute(rphfLookups, one, true)) {
          buf.masks[start + 1] = buf.masks[start + 1]! | MASK_RPHF
        }
      }
    }
    if (prefLookups.length > 0) {
      // pref applies to halant+consonant pairs or single pre-base forms
      // (e.g. Cham medial ra); substituted glyphs reorder like VPre
      for (let i = start + 1; i < end; i++) {
        if (i + 1 < end && isHalantCat(auxCategory(buf.aux[i]!))) {
          const pair = [buf.glyphs[i]!, buf.glyphs[i + 1]!]
          if (gsub.wouldSubstitute(prefLookups, pair, true)) {
            buf.masks[i] = buf.masks[i]! | MASK_PREF
            buf.masks[i + 1] = buf.masks[i + 1]! | MASK_PREF
            prefFlags[i + 1] = true
            continue
          }
        }
        // Single-glyph pref only reorders inherently pre-base medials
        // (zero-context probes would over-fire on other categories)
        if (auxCategory(buf.aux[i]!) === U_MPRE && gsub.wouldSubstitute(prefLookups, [buf.glyphs[i]!], true)) {
          buf.masks[i] = buf.masks[i]! | MASK_PREF
          prefFlags[i] = true
        }
      }
    }
    start = end
  }

  gsub.applyShapingFeatures(buf, USE_PREPROCESS_STAGE, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)
  gsub.applyShapingFeatures(buf, USE_RPHF_STAGE, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)
  gsub.applyShapingFeatures(buf, USE_PREF_STAGE, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)
  gsub.applyShapingFeatures(buf, USE_BASIC_STAGE, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  // Reorder after the basic features (hb: reorder_use pause).
  for (let start = 0; start < buf.glyphs.length;) {
    let end = start + 1
    while (end < buf.glyphs.length && buf.syllables[end] === buf.syllables[start]) end++
    reorderSyllableUse(buf, start, end, prefFlags)
    start = end
  }

  // Topographical joining forms across adjacent clusters.
  setupTopographicalMasks(buf)
  gsub.applyShapingFeatures(buf, USE_TOPO_STAGE, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  const finalFeatures = appendUserShapingFeatures(USE_FINAL_FEATURES, USE_BUILTIN_TAGS, ctx)
  gsub.applyShapingFeatures(buf, finalFeatures, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  return { glyphIds: buf.glyphs, clusters: buf.clusters, sourceClusters: buf.sourceClusters, flags: buf.flags }
}
