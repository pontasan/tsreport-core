/**
 * Tibetan shaper.
 *
 * Tibetan fonts expect stack-local processing in a fixed OpenType feature
 * order: language composition, above/below-base substitutions, contextual
 * forms, and ligatures. The input is already encoded top-to-bottom inside a
 * stack; normalization here preserves the shaping-engine modified combining
 * class order used for Tibetan vowel signs and final marks.
 */

import type { GsubShapingFeature } from '../parsers/tables/gsub.js'
import { GLYPH_FLAG_DEFAULT_IGNORABLE, GSUB_MASK_GLOBAL } from '../parsers/tables/gsub.js'
import { appendUserShapingFeatures, type ShapeContext } from './complex.js'
import { reorderMarkRuns } from './normalize.js'
import { isDefaultIgnorable } from './unicode-general-category.js'
import { getUnicodeScript } from './unicode-shaping-properties.js'

const TIBETAN_STAGE_LOCL_CCMP: readonly GsubShapingFeature[] = [
  { tag: 'locl', mask: GSUB_MASK_GLOBAL, perSyllable: true },
  { tag: 'ccmp', mask: GSUB_MASK_GLOBAL, perSyllable: true },
]

const TIBETAN_STAGE_ABVS: readonly GsubShapingFeature[] = [
  { tag: 'abvs', mask: GSUB_MASK_GLOBAL, perSyllable: true },
]

const TIBETAN_STAGE_BLWS: readonly GsubShapingFeature[] = [
  { tag: 'blws', mask: GSUB_MASK_GLOBAL, perSyllable: true },
]

const TIBETAN_STAGE_CONTEXT: readonly GsubShapingFeature[] = [
  { tag: 'calt', mask: GSUB_MASK_GLOBAL, perSyllable: true },
]

const TIBETAN_FINAL_FEATURES: readonly GsubShapingFeature[] = [
  { tag: 'liga', mask: GSUB_MASK_GLOBAL, perSyllable: true },
]

const TIBETAN_BUILTIN_TAGS = new Set([
  'locl', 'ccmp', 'abvs', 'blws', 'calt', 'liga',
])

/** Whether the code point belongs to the Tibetan block. */
export function isTibetanChar(cp: number): boolean {
  return getUnicodeScript(cp) === 'Tibetan'
}

export function shapeTibetan(
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

  const n = cps.length
  const glyphs: number[] = new Array(n)
  const masks: number[] = new Array(n)
  const syllables: number[] = new Array(n)
  const aux: number[] = new Array(n)
  const flags: number[] = new Array(n)
  let serial = 1
  for (let i = 0; i < n; i++) {
    const cp = cps[i]!
    glyphs[i] = ctx.font.getGlyphId(cp)
    masks[i] = GSUB_MASK_GLOBAL
    syllables[i] = serial << 4
    aux[i] = 0
    flags[i] = isDefaultIgnorable(cp) ? GLYPH_FLAG_DEFAULT_IGNORABLE : 0
    if (isTibetanSyllableDelimiter(cp) || !isTibetanStackMember(cp)) serial++
  }

  const buf = { glyphs, masks, clusters, sourceClusters, syllables, aux, flags }
  const scriptTag = ctx.script ?? 'tibt'

  ctx.gsub.applyShapingFeatures(buf, TIBETAN_STAGE_LOCL_CCMP, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)
  ctx.gsub.applyShapingFeatures(buf, TIBETAN_STAGE_ABVS, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)
  ctx.gsub.applyShapingFeatures(buf, TIBETAN_STAGE_BLWS, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)
  ctx.gsub.applyShapingFeatures(buf, TIBETAN_STAGE_CONTEXT, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  const finalFeatures = appendUserShapingFeatures(TIBETAN_FINAL_FEATURES, TIBETAN_BUILTIN_TAGS, ctx)
  ctx.gsub.applyShapingFeatures(buf, finalFeatures, scriptTag, ctx.language, ctx.gdef, ctx.normalizedCoords, ctx.jstfLookupModifications, ctx.featureSettings)

  return { glyphIds: buf.glyphs, clusters: buf.clusters, sourceClusters: buf.sourceClusters, flags: buf.flags }
}

function isTibetanSyllableDelimiter(cp: number): boolean {
  return cp === 0x0F0B || cp === 0x0F0C || cp === 0x0F34 || cp === 0x0FD2
}

function isTibetanStackMember(cp: number): boolean {
  return (cp >= 0x0F40 && cp <= 0x0F6C) ||
    (cp >= 0x0F88 && cp <= 0x0F8C) ||
    (cp >= 0x0F8D && cp <= 0x0FBC) ||
    cp === 0x0F71 ||
    cp === 0x0F72 ||
    (cp >= 0x0F7A && cp <= 0x0F7D) ||
    cp === 0x0F80 ||
    cp === 0x0F73 ||
    (cp >= 0x0F75 && cp <= 0x0F79) ||
    cp === 0x0F81 ||
    cp === 0x0F35 ||
    cp === 0x0F37 ||
    cp === 0x0F39 ||
    cp === 0x0F7E ||
    cp === 0x0F7F ||
    (cp >= 0x0F82 && cp <= 0x0F84) ||
    (cp >= 0x0F86 && cp <= 0x0F87) ||
    cp === 0x0FC6
}
