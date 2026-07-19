import type { Font, ShapedGlyph, ShapeOptions } from '../font.js'
import type { TextMeasurement } from '../types/index.js'

/** Count code points (surrogate pair aware) */
function countCodePoints(text: string): number {
  let count = 0
  let i = 0
  while (i < text.length) {
    const cp = text.codePointAt(i)!
    i += cp > 0xFFFF ? 2 : 1
    count++
  }
  return count
}

/**
 * Measurement result that also carries the shaping result,
 * so that layout can reuse the exact glyphs it was measured with.
 */
export interface ShapedMeasurement extends TextMeasurement {
  /** Raw shaping result (values in font units) */
  shaped: ShapedGlyph[]
  /** Code point index → shaped glyph index (ligatures map several code points to one glyph) */
  cpToGlyph: Int32Array
  /** Caller shaping options reused when a line boundary requires reshaping. */
  shapeOptions?: Omit<ShapeOptions, 'direction' | 'trackingAdjustment'>
}

/**
 * Text measurement
 * Computes text width based on font metrics
 * Supports GSUB/GPOS shaping
 */
export class TextMeasurer {
  readonly font: Font

  constructor(font: Font) {
    this.font = font
  }

  /**
   * Measure the width of text
   * Applies GSUB (ligatures, etc.) and GPOS (kerning, etc.)
   * @param text Text to measure
   * @param fontSize Font size (points)
   * @returns Measurement result
   */
  measure(
    text: string,
    fontSize: number,
    options?: Omit<ShapeOptions, 'direction' | 'trackingAdjustment'>,
  ): TextMeasurement {
    const scale = fontSize / this.font.metrics.unitsPerEm
    const numCodePoints = [...text].length

    // Use shaping to obtain results with GSUB/GPOS applied
    const shaped = this.font.shapeText(text, options)

    // Ligatures etc. can make shaped.length !== numCodePoints, so always
    // return an array sized by code point count (breakLines etc. index per char)
    const advances = new Float64Array(numCodePoints)
    let totalWidth = 0
    let cpIdx = 0

    for (let i = 0; i < shaped.length; i++) {
      const advanceWidth = shaped[i]!.xAdvance * scale
      totalWidth += advanceWidth
      const compCount = shaped[i]!.componentCount

      if (compCount === 0) {
        // Continuation glyph of the previous cluster (e.g. a mark split off by
        // a decomposition): fold its advance into the previous code point
        if (cpIdx > 0) {
          advances[cpIdx - 1]! += advanceWidth
        }
      } else if (compCount > 1) {
        // Ligature: distribute the advance width evenly across component code points
        const perCp = advanceWidth / compCount
        for (let c = 0; c < compCount && cpIdx < numCodePoints; c++) {
          advances[cpIdx++] = perCp
        }
      } else {
        if (cpIdx < numCodePoints) {
          advances[cpIdx++] = advanceWidth
        }
      }
    }

    return {
      width: totalWidth,
      advances,
    }
  }

  /**
   * Measure text and return the shaping result together with per-code-point advances.
   * Performs exactly one shaping pass; the caller reuses the shaped glyphs for rendering.
   * @param text Text to measure
   * @param fontSize Font size (points)
   * @param vertical Vertical writing mode (applies vert/vrt2 and uses vertical advances)
   */
  measureShaped(
    text: string,
    fontSize: number,
    vertical: boolean,
    trackingAdjustment = 0,
    ppem?: number,
    options?: Omit<ShapeOptions, 'direction' | 'trackingAdjustment' | 'ppem'>,
  ): ShapedMeasurement {
    const scale = fontSize / this.font.metrics.unitsPerEm
    const numCodePoints = countCodePoints(text)
    const shapeOptions: ShapeOptions = {
      ...options,
      direction: vertical ? 'vertical' : 'horizontal',
      trackingAdjustment: scale === 0 ? 0 : trackingAdjustment / scale,
      ppem,
    }
    const shaped = this.font.shapeText(text, shapeOptions)

    const advances = new Float64Array(numCodePoints)
    const cpToGlyph = new Int32Array(numCodePoints)
    let totalWidth = 0
    let cpIdx = 0

    for (let i = 0; i < shaped.length; i++) {
      const g = shaped[i]!
      const advance = (vertical ? g.yAdvance : g.xAdvance) * scale
      totalWidth += advance
      const compCount = g.componentCount

      if (compCount === 0) {
        // Continuation glyph of the previous cluster (e.g. a mark split off by
        // a decomposition): fold its advance into the previous code point.
        // cpToGlyph keeps pointing at the first glyph of the cluster.
        if (cpIdx > 0) {
          advances[cpIdx - 1]! += advance
        }
      } else if (compCount > 1) {
        // Ligature: distribute the advance evenly across component code points
        const perCp = advance / compCount
        for (let c = 0; c < compCount && cpIdx < numCodePoints; c++) {
          advances[cpIdx] = perCp
          cpToGlyph[cpIdx] = i
          cpIdx++
        }
      } else if (cpIdx < numCodePoints) {
        advances[cpIdx] = advance
        cpToGlyph[cpIdx] = i
        cpIdx++
      }
    }

    return {
      width: totalWidth,
      advances,
      shaped,
      cpToGlyph,
      shapeOptions: options === undefined && ppem === undefined ? undefined : { ...options, ppem },
    }
  }

  /**
   * Measure the width of text (simplified version, no GSUB/GPOS)
   * Kept for backward compatibility
   * @param text Text to measure
   * @param fontSize Font size (points)
   * @returns Measurement result
   */
  measureSimple(text: string, fontSize: number): TextMeasurement {
    const scale = fontSize / this.font.metrics.unitsPerEm
    const codePoints = [...text]
    const advances = new Float64Array(codePoints.length)
    let totalWidth = 0

    let prevGlyphId = -1
    for (let i = 0; i < codePoints.length; i++) {
      const cp = codePoints[i]!.codePointAt(0)!
      const glyphId = this.font.getGlyphId(cp)
      let advanceWidth = this.font.getAdvanceWidth(glyphId) * scale

      // Apply kerning
      if (prevGlyphId >= 0) {
        advanceWidth += this.font.getKerning(prevGlyphId, glyphId) * scale
      }

      advances[i] = advanceWidth
      totalWidth += advanceWidth
      prevGlyphId = glyphId
    }

    return {
      width: totalWidth,
      advances,
    }
  }

  /**
   * Compute the line height
   * @param fontSize Font size (points)
   * @returns Line height (points)
   */
  getLineHeight(fontSize: number): number {
    const metrics = this.font.metrics
    const scale = fontSize / metrics.unitsPerEm
    return (metrics.ascender - metrics.descender + metrics.lineGap) * scale
  }

  /**
   * Get the ascender height
   * @param fontSize Font size (points)
   */
  getAscent(fontSize: number): number {
    const scale = fontSize / this.font.metrics.unitsPerEm
    return this.font.metrics.ascender * scale
  }

  /**
   * Get the descender depth (usually negative)
   * @param fontSize Font size (points)
   */
  getDescent(fontSize: number): number {
    const scale = fontSize / this.font.metrics.unitsPerEm
    return this.font.metrics.descender * scale
  }

  /**
   * Measure the vertical advances of vertical text
   * Applies vertical shaping (vert/vrt2) so metrics match the glyphs actually drawn
   * @param text Text to measure
   * @param fontSize Font size (points)
   * @returns Per-character advance heights and the total height
   */
  measureVertical(text: string, fontSize: number): { advances: Float64Array; totalHeight: number } {
    const m = this.measureShaped(text, fontSize, true)
    return { advances: m.advances, totalHeight: m.width }
  }
}
