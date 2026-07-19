// CFF (Type2 charstring) outline correctness against the fontTools reference.
//
// The expected advance widths and tight glyph bounds below were produced by
// fontTools' BoundsPen over getGlyphSet() for the bundled CFF/OTF fixtures.
// Matching them exactly validates the Type2 charstring interpreter — curve and
// flex operators, hstem/vstem/hintmask width parsing, local/global subrs and
// accented composites — against an independent implementation, for absolute
// outline correctness rather than mere finiteness.

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
  'SourceSans3-Regular.otf': {
    A: { adv: 544, bbox: [3, 0, 541, 656] },
    a: { adv: 504, bbox: [51, -12, 433, 498] },
    g: { adv: 504, bbox: [45, -224, 492, 498] },
    e: { adv: 496, bbox: [45, -12, 458, 498] },
    'é': { adv: 496, bbox: [45, -12, 458, 735] },
    'ﬁ': { adv: 538, bbox: [24, 0, 470, 724] },
    '8': { adv: 497, bbox: [41, -12, 456, 650] },
    Q: { adv: 664, bbox: [52, -165, 627, 668] },
    '@': { adv: 847, bbox: [51, -155, 797, 646] },
    'ñ': { adv: 547, bbox: [82, 0, 471, 721] },
    '&': { adv: 609, bbox: [32, -12, 594, 668] },
    x: { adv: 446, bbox: [14, 0, 432, 486] },
  },
  'STIXTwoMath-Regular.otf': {
    '∑': { adv: 936, bbox: [62, -248, 861, 782] },
    '∫': { adv: 684, bbox: [30, -226, 654, 727] },
    '√': { adv: 794, bbox: [18, -265, 829, 922] },
    '∞': { adv: 953, bbox: [75, 0, 878, 440] },
    '≠': { adv: 720, bbox: [62, -160, 658, 678] },
    A: { adv: 718, bbox: [3, 0, 714, 662] },
    x: { adv: 479, bbox: [-2, 0, 482, 473] },
    '8': { adv: 495, bbox: [46, -12, 448, 647] },
  },
  'FiraMath-Regular.otf': {
    '∑': { adv: 685, bbox: [56, -151, 629, 711] },
    '∫': { adv: 701, bbox: [50, -216, 651, 834] },
    '√': { adv: 649, bbox: [16, -200, 664, 952] },
    '∞': { adv: 895, bbox: [55, 72, 840, 487] },
    '≠': { adv: 500, bbox: [62, 14, 438, 546] },
    A: { adv: 573, bbox: [6, 0, 567, 689] },
    x: { adv: 485, bbox: [5, 0, 480, 527] },
    '8': { adv: 560, bbox: [47, -12, 512, 701] },
  },
}

describe('CFF outline matches the fontTools reference', () => {
  for (const file of Object.keys(ORACLE)) {
    const path = resolve(FONTS, file)
    it.skipIf(!existsSync(path))(`advance widths and tight bounds equal fontTools for ${file}`, () => {
      const font = Font.load(readFileSync(path).buffer as ArrayBuffer)
      expect(font.isCff).toBe(true)
      for (const ch of Object.keys(ORACLE[file]!)) {
        const gid = font.getGlyphId(ch.codePointAt(0)!)
        expect(gid, `glyph for ${ch}`).toBeGreaterThan(0)
        expect(Math.round(font.getAdvanceWidth(gid)), `${ch} advance`).toBe(ORACLE[file]![ch]!.adv)
        expect(tightBounds(font.getGlyph(gid).outline), `${ch} bounds`).toEqual(ORACLE[file]![ch]!.bbox)
      }
    })
  }
})
