/**
 * Shared types and the comparison function for the HarfBuzz shaping
 * compatibility suite.
 *
 * Comparison model:
 * - hb-shape cluster values (cl) and ShapedGlyph.cluster are zero-based input
 *   code-point indices and are compared directly.
 * - RTL: hb-shape emits glyphs in visual order (reversed); Font.shapeText()
 *   keeps logical order. The hb glyph array is reversed before comparing.
 * - TTB: hb-shape emits negative ay (y-up coordinate system) and bakes the
 *   horizontal/vertical origin shifts into dx/dy. Font.shapeText() returns the
 *   GPOS placement before those render-time origin shifts, so the comparison
 *   applies the same OpenType origin metrics before comparing offsets.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HbCompatCase } from './cases.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const EXPECTATIONS_DIR = resolve(SCRIPT_DIR, 'expectations')

/** One glyph in hb-shape --output-format=json output (font units). */
export interface HbGlyph {
  g: number
  cl: number
  dx: number
  dy: number
  ax: number
  ay: number
}

/** Committed expectation file format. */
export interface Expectation {
  font: string
  text: string
  options: {
    direction: 'ltr' | 'rtl' | 'ttb'
    script?: string
    hbScript?: string
    language?: string
    hbLanguage?: string
    features: string[]
    hbFeatures: string
    variations?: Record<string, number>
  }
  glyphs: HbGlyph[]
}

/** Minimal structural copy of ShapedGlyph (avoids importing src into shared code). */
export interface ShapedGlyphLike {
  glyphId: number
  cluster: number
  xOffset: number
  yOffset: number
  xAdvance: number
  yAdvance: number
  componentCount: number
}

export interface VerticalOriginMetrics {
  getAdvanceWidth(glyphId: number): number
  getVerticalOrigin(glyphId: number): number
}

export function loadExpectation(caseId: string): Expectation {
  const path = resolve(EXPECTATIONS_DIR, `${caseId}.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Expectation
}

/**
 * Compare hb-shape output against Font.shapeText() output.
 * @returns null when they match, otherwise a human-readable diff description.
 */
export function compareCase(
  c: HbCompatCase,
  expected: Expectation,
  actual: ShapedGlyphLike[],
  font: VerticalOriginMetrics,
): string | null {
  const direction = c.direction ?? 'ltr'
  // RTL: reverse hb visual order back to logical order.
  const hbGlyphs = direction === 'rtl' ? [...expected.glyphs].reverse() : expected.glyphs

  const diffs: string[] = []
  let clusterMismatch = false

  if (hbGlyphs.length !== actual.length) {
    diffs.push(
      `glyph count: hb=${hbGlyphs.length} ts=${actual.length}` +
      ` (hb=[${hbGlyphs.map((g) => g.g).join(',')}] ts=[${actual.map((g) => g.glyphId).join(',')}])`,
    )
  } else {
    for (let i = 0; i < hbGlyphs.length; i++) {
      const hb = hbGlyphs[i]!
      const ts = actual[i]!
      const local: string[] = []
      if (hb.g !== ts.glyphId) local.push(`g hb=${hb.g} ts=${ts.glyphId}`)
      if (hb.cl !== ts.cluster) {
        clusterMismatch = true
        local.push(`cl hb=${hb.cl} ts=${ts.cluster} components=${ts.componentCount}`)
      }
      if (direction === 'ttb') {
        if (hb.ax !== ts.xAdvance) local.push(`ax hb=${hb.ax} ts=${ts.xAdvance}`)
        if (-hb.ay !== ts.yAdvance) local.push(`ay hb=${hb.ay} ts(yAdvance)=${ts.yAdvance}`)
        const xOffset = ts.xOffset - Math.trunc(font.getAdvanceWidth(ts.glyphId) / 2)
        const yOffset = ts.yOffset - font.getVerticalOrigin(ts.glyphId)
        if (hb.dx !== xOffset) local.push(`dx hb=${hb.dx} ts(origin-adjusted)=${xOffset}`)
        if (hb.dy !== yOffset) local.push(`dy hb=${hb.dy} ts(origin-adjusted)=${yOffset}`)
      } else {
        if (hb.ax !== ts.xAdvance) local.push(`ax hb=${hb.ax} ts=${ts.xAdvance}`)
        if (hb.ay !== ts.yAdvance) local.push(`ay hb=${hb.ay} ts=${ts.yAdvance}`)
        if (hb.dx !== ts.xOffset) local.push(`dx hb=${hb.dx} ts=${ts.xOffset}`)
        if (hb.dy !== ts.yOffset) local.push(`dy hb=${hb.dy} ts=${ts.yOffset}`)
      }
      if (local.length > 0) diffs.push(`[${i}] ${local.join(', ')}`)
    }
  }

  if (clusterMismatch) {
    diffs.push(`clusters hb=[${hbGlyphs.map(g => g.cl).join(',')}] ts=[${actual.map(g => g.cluster).join(',')}] components=[${actual.map(g => g.componentCount).join(',')}]`)
  }

  return diffs.length === 0 ? null : diffs.join('; ')
}
