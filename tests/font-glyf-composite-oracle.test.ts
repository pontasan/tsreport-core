// TrueType (glyf) composite-glyph outline correctness against fontTools.
//
// The expected advance widths and tight glyph bounds below were produced by
// fontTools' BoundsPen over getGlyphSet() for the bundled TrueType fixtures.
// Every glyph here is a composite in these fonts (except the simple 'A'
// control): matching fontTools exactly validates the component resolver —
// ARGS_ARE_XY offsets, component scaling, and stacked diacritics (ĝ, Ọ) — for
// absolute outline correctness rather than mere finiteness. This is the glyf
// counterpart to the gvar (interpolated) and CFF oracle suites.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Font } from '../src/index.js'
import type { GlyphOutline } from '../src/types/glyph.js'

const FONTS = resolve(__dirname, 'fixtures/fonts')

interface Expected { adv: number, bbox: [number, number, number, number] }

// Tight bounds of a cubic-normalized outline: flatten each curve and track extents.
function tightBounds(outline: GlyphOutline): [number, number, number, number] {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  let ci = 0, cx = 0, cy = 0
  for (let i = 0; i < outline.commands.length; i++) {
    const c = outline.commands[i]!
    if (c === 0 || c === 1) {
      cx = outline.coords[ci++]!; cy = outline.coords[ci++]!
      if (cx < xMin) xMin = cx; if (cy < yMin) yMin = cy
      if (cx > xMax) xMax = cx; if (cy > yMax) yMax = cy
    } else if (c === 2) {
      const x1 = outline.coords[ci++]!, y1 = outline.coords[ci++]!
      const x2 = outline.coords[ci++]!, y2 = outline.coords[ci++]!
      const x = outline.coords[ci++]!, y = outline.coords[ci++]!
      for (let t = 1; t <= 24; t++) {
        const u = t / 24, m = 1 - u
        const bx = m * m * m * cx + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u * x
        const by = m * m * m * cy + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * y
        if (bx < xMin) xMin = bx; if (by < yMin) yMin = by
        if (bx > xMax) xMax = bx; if (by > yMax) yMax = by
      }
      cx = x; cy = y
    }
  }
  return [Math.round(xMin), Math.round(yMin), Math.round(xMax), Math.round(yMax)]
}

// fontTools reference values (BoundsPen over getGlyphSet, hmtx advance).
const ORACLE: Record<string, Record<string, Expected>> = {
  'Roboto-Regular.ttf': {
    'é': { adv: 1085, bbox: [93, -20, 1011, 1536] },
    'ñ': { adv: 1130, bbox: [140, 0, 991, 1516] },
    'Å': { adv: 1336, bbox: [28, 0, 1309, 1937] },
    'ü': { adv: 1129, bbox: [136, -20, 988, 1477] },
    'ï': { adv: 506, bbox: [-69, 0, 580, 1476] },
    'ç': { adv: 1072, bbox: [92, -444, 1004, 1102] },
    'ĝ': { adv: 1149, bbox: [96, -426, 1010, 1536] },
    'Ọ': { adv: 1408, bbox: [118, -350, 1289, 1476] },
    A: { adv: 1336, bbox: [28, 0, 1309, 1456] },
  },
  'NotoSans-Regular.ttf': {
    'é': { adv: 564, bbox: [55, -10, 513, 766] },
    'ñ': { adv: 618, bbox: [85, 0, 537, 735] },
    'Å': { adv: 639, bbox: [0, 0, 638, 878] },
    'ü': { adv: 618, bbox: [79, -10, 533, 730] },
    'ï': { adv: 258, bbox: [-11, 0, 270, 730] },
    'ç': { adv: 480, bbox: [55, -240, 447, 546] },
    'ĝ': { adv: 615, bbox: [55, -240, 530, 766] },
    'Ọ': { adv: 781, bbox: [61, -176, 720, 725] },
    A: { adv: 639, bbox: [0, 0, 638, 717] },
  },
}

describe('glyf composite outline matches the fontTools reference', () => {
  for (const file of Object.keys(ORACLE)) {
    const path = resolve(FONTS, file)
    it.skipIf(!existsSync(path))(`advance widths and tight bounds equal fontTools for ${file}`, () => {
      const font = Font.load(readFileSync(path).buffer as ArrayBuffer)
      expect(font.isCff).toBe(false)
      for (const ch of Object.keys(ORACLE[file]!)) {
        const gid = font.getGlyphId(ch.codePointAt(0)!)
        expect(gid, `glyph for ${ch}`).toBeGreaterThan(0)
        expect(Math.round(font.getAdvanceWidth(gid)), `${ch} advance`).toBe(ORACLE[file]![ch]!.adv)
        expect(tightBounds(font.getGlyph(gid).outline), `${ch} bounds`).toEqual(ORACLE[file]![ch]!.bbox)
      }
    })
  }
})
