import type { GlyphOutline } from '../types/glyph.js'

export interface PositionedGlyphOutline {
  outline: GlyphOutline
  originX: number
  originY: number
  xScale: number
  yScale: number
  rotation?: 0 | 90
}

/**
 * Combines positioned glyph outlines into one pseudo font-space path. Passing
 * the result to a backend's normal glyph-path routine with origin (0, 0),
 * scale 1, and no slant produces the original device coordinates in one fill.
 */
export function mergePositionedGlyphOutlines(
  glyphs: readonly PositionedGlyphOutline[],
  scale: number,
  horizontalScale: number,
  slant: number,
): GlyphOutline {
  let commandCount = 0
  let coordinateCount = 0
  for (let i = 0; i < glyphs.length; i++) {
    commandCount += glyphs[i]!.outline.commands.length
    coordinateCount += glyphs[i]!.outline.coords.length
  }
  const commands = new Uint8Array(commandCount)
  const coords = new Float32Array(coordinateCount)
  let commandOffset = 0
  let coordinateOffset = 0
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i]!
    commands.set(glyph.outline.commands, commandOffset)
    const source = glyph.outline.coords
    for (let j = 0; j < source.length; j += 2) {
      const x = source[j]!
      const y = source[j + 1]!
      if (glyph.rotation === 90) {
        coords[coordinateOffset + j] = glyph.originX + y * scale * glyph.yScale
        coords[coordinateOffset + j + 1] = -glyph.originY - (x + y * slant) * scale * horizontalScale * glyph.xScale
      } else {
        coords[coordinateOffset + j] = glyph.originX + (x + y * slant) * scale * horizontalScale * glyph.xScale
        // Store negative device Y because glyph-path routines map y as baseY - y.
        coords[coordinateOffset + j + 1] = -glyph.originY + y * scale * glyph.yScale
      }
    }
    commandOffset += glyph.outline.commands.length
    coordinateOffset += source.length
  }
  return { commands, coords }
}
