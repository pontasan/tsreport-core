/**
 * Glyph run construction
 *
 * Converts shaping results (font units) into RenderGlyphRun values (pt)
 * with letter/word spacing baked into the per-glyph advances.
 * Used by the text layout engine (slicing paragraph-level shaping results
 * into lines) and by render backends for direct drawText calls.
 */

import type { Font, ShapedGlyph, ShapeOptions } from '../font.js'
import type { RenderGlyphRun } from '../types/render.js'

/**
 * Build a RenderGlyphRun from a slice of a shaping result.
 *
 * @param shaped Shaping result (font units)
 * @param gStart First glyph index of the slice (inclusive)
 * @param gEnd Last glyph index of the slice (exclusive)
 * @param scale fontSize / unitsPerEm
 * @param letterSpacing Extra spacing per source code point (pt)
 * @param wordSpacing Extra spacing per space character (pt)
 * @param chars Source code points aligned with the slice; chars[cpStart] is the
 *              first code point of glyph gStart. Required when wordSpacing !== 0.
 * @param cpStart Code point index of the first glyph of the slice
 * @param vertical Use vertical advances (yAdvance) instead of horizontal (xAdvance)
 * @param horizontalScale Horizontal advance scale for horizontal writing
 */
export function buildGlyphRunFromShaped(
  shaped: ShapedGlyph[],
  gStart: number,
  gEnd: number,
  scale: number,
  letterSpacing: number,
  wordSpacing: number,
  chars: string[] | null,
  cpStart: number,
  vertical: boolean,
  horizontalScale = 1,
): RenderGlyphRun {
  const n = gEnd - gStart
  const glyphIds = new Uint16Array(n)
  const advances = new Float64Array(n)
  const xOffsets = new Float64Array(n)
  const yOffsets = new Float64Array(n)
  const clusters = new Uint16Array(n)
  const sourceClusters = new Uint32Array(n)
  const rotations = vertical ? new Uint8Array(n) : undefined

  let cpIdx = cpStart
  for (let i = 0; i < n; i++) {
    const g = shaped[gStart + i]!
    const compCount = g.componentCount
    glyphIds[i] = g.glyphId
    clusters[i] = compCount
    sourceClusters[i] = g.cluster - cpStart
    if (rotations !== undefined) rotations[i] = g.verticalRotation ?? 0
    let advance = (vertical ? g.yAdvance : g.xAdvance) * scale + letterSpacing * compCount
    if (wordSpacing !== 0 && compCount === 1 && chars !== null && chars[cpIdx] === ' ') {
      advance += wordSpacing
    }
    if (!vertical) advance *= horizontalScale
    advances[i] = advance
    xOffsets[i] = g.xOffset * scale * (vertical ? 1 : horizontalScale)
    yOffsets[i] = g.yOffset * scale
    cpIdx += compCount
  }

  return { glyphIds, advances, xOffsets, yOffsets, clusters, sourceClusters, rotations }
}

/**
 * Shape a whole text and build its RenderGlyphRun in a single pass.
 */
export function shapeGlyphRun(
  font: Font,
  text: string,
  fontSize: number,
  letterSpacing: number,
  wordSpacing: number,
  vertical: boolean,
  horizontalScale = 1,
  direction: 'ltr' | 'rtl' = 'ltr',
  options?: Omit<ShapeOptions, 'direction' | 'trackingAdjustment'>,
): RenderGlyphRun {
  const scale = fontSize / font.metrics.unitsPerEm
  const shapeOptions: ShapeOptions = {
    ...options,
    direction: vertical ? 'vertical' as const : 'horizontal' as const,
    trackingAdjustment: scale === 0 ? 0 : letterSpacing / scale,
  }
  const shaped = font.shapeText(text, shapeOptions)
  const chars = wordSpacing !== 0 ? [...text] : null
  const run = buildGlyphRunFromShaped(shaped, 0, shaped.length, scale, letterSpacing, wordSpacing, chars, 0, vertical, horizontalScale)
  applyMergeGroupsToRun(run, font, direction)
  return run
}

/** Marks the contiguous glyph sequences that MERG requires to share antialias filtering. */
export function applyMergeGroupsToRun(run: RenderGlyphRun, font: Font, direction: 'ltr' | 'rtl'): void {
  const merg = font.merg
  if (merg == null || run.glyphIds.length < 2) return
  const groups = merg.getMergeGroups(run.glyphIds, direction)
  let requiredCount = 0
  for (let i = 0; i < groups.length; i++) {
    if (groups[i]!.mergeRequired && groups[i]!.end - groups[i]!.start > 1) requiredCount++
  }
  if (requiredCount === 0) return
  const mergeGroups = new Uint32Array(run.glyphIds.length)
  let groupId = 1
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!
    if (!group.mergeRequired || group.end - group.start <= 1) continue
    for (let glyphIndex = group.start; glyphIndex < group.end; glyphIndex++) mergeGroups[glyphIndex] = groupId
    groupId++
  }
  run.mergeGroups = mergeGroups
}
