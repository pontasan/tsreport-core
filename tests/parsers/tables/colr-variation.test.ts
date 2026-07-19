import { describe, it, expect } from 'vitest'
import { BinaryReader } from '../../../src/binary/reader.js'
import { parseColr } from '../../../src/parsers/tables/colr.js'
import type { PaintSolid, PaintTranslate, PaintLinearGradient } from '../../../src/parsers/tables/colr.js'
import { Font } from '../../../src/font.js'
import { parseFont } from '../../../src/parsers/index.js'
import { buildTestFont, buildTable, encodeSimpleGlyph } from '../../renderer/synthetic-font.js'

/**
 * COLR v1 variation: ItemVariationStore + VarIndexMap deltas applied to
 * PaintVar* values, VarColorStops and ClipBox format 2.
 */

function writeF2Dot14(view: DataView, pos: number, value: number): void {
  view.setInt16(pos, Math.round(value * (1 << 14)))
}

function writeOffset24(view: DataView, pos: number, value: number): void {
  view.setUint8(pos, (value >> 16) & 0xFF)
  view.setUint8(pos + 1, (value >> 8) & 0xFF)
  view.setUint8(pos + 2, value & 0xFF)
}

/**
 * ItemVariationStore: 1 axis, 1 region (start 0 / peak 1 / end 1), one
 * ItemVariationData whose items each carry a single int16 delta.
 */
function writeIvs(view: DataView, start: number, deltas: number[]): number {
  let pos = start
  view.setUint16(pos, 1); pos += 2 // format
  const regionListOffsetPos = pos; pos += 4
  view.setUint16(pos, 1); pos += 2 // itemVariationDataCount
  const dataOffsetPos = pos; pos += 4

  // VariationRegionList
  view.setUint32(regionListOffsetPos, pos - start)
  view.setUint16(pos, 1); pos += 2 // axisCount
  view.setUint16(pos, 1); pos += 2 // regionCount
  writeF2Dot14(view, pos, 0); pos += 2 // startCoord
  writeF2Dot14(view, pos, 1); pos += 2 // peakCoord
  writeF2Dot14(view, pos, 1); pos += 2 // endCoord

  // ItemVariationData
  view.setUint32(dataOffsetPos, pos - start)
  view.setUint16(pos, deltas.length); pos += 2 // itemCount
  view.setUint16(pos, 1); pos += 2 // wordDeltaCount (all int16)
  view.setUint16(pos, 1); pos += 2 // regionIndexCount
  view.setUint16(pos, 0); pos += 2 // regionIndices[0]
  for (const d of deltas) {
    view.setInt16(pos, d); pos += 2
  }
  return pos
}

interface BuildOptions {
  /** item deltas (delta-set inner index = array index) */
  deltas: number[]
  /** VarIndexMap entries mapping varIndex → inner index (optional) */
  varIndexMap?: number[]
}

/**
 * COLR v1 table with:
 *  - glyph 5 → PaintVarSolid(palette 0, alpha 1.0, varIndexBase 0)
 *  - glyph 6 → PaintVarTranslate(dx 100, dy 50, varIndexBase 1) → PaintSolid
 *  - glyph 7 → PaintVarLinearGradient(varIndexBase 3) with one VarColorStop (varIndexBase 9)
 *  - ClipBox format 2 for glyph 5 (varIndexBase 11)
 */
function buildVarColr(opts: BuildOptions): ArrayBuffer {
  const buf = new ArrayBuffer(2048)
  const view = new DataView(buf)
  let pos = 0

  // v0 header
  view.setUint16(pos, 1); pos += 2 // version
  view.setUint16(pos, 0); pos += 2 // numBaseGlyphRecords
  view.setUint32(pos, 0); pos += 4 // baseGlyphRecordsOffset
  view.setUint32(pos, 0); pos += 4 // layerRecordsOffset
  view.setUint16(pos, 0); pos += 2 // numLayerRecords

  // v1 header
  const baseGlyphListOffsetPos = pos; pos += 4
  const layerListOffsetPos = pos; pos += 4
  const clipListOffsetPos = pos; pos += 4
  const varIndexMapOffsetPos = pos; pos += 4
  const ivsOffsetPos = pos; pos += 4
  view.setUint32(layerListOffsetPos, 0)

  // BaseGlyphList
  const baseGlyphListOffset = pos
  view.setUint32(baseGlyphListOffsetPos, baseGlyphListOffset)
  view.setUint32(pos, 3); pos += 4 // numBaseGlyphPaintRecords
  const rec5PaintOffsetPos = pos + 2
  view.setUint16(pos, 5); pos += 6
  const rec6PaintOffsetPos = pos + 2
  view.setUint16(pos, 6); pos += 6
  const rec7PaintOffsetPos = pos + 2
  view.setUint16(pos, 7); pos += 6

  // Paint area
  // glyph 5: PaintVarSolid
  view.setUint32(rec5PaintOffsetPos, pos - baseGlyphListOffset)
  view.setUint8(pos, 3); pos += 1 // format 3
  view.setUint16(pos, 0); pos += 2 // paletteIndex
  writeF2Dot14(view, pos, 1.0); pos += 2 // alpha
  view.setUint32(pos, 0); pos += 4 // varIndexBase

  // glyph 6: PaintVarTranslate → PaintSolid
  const translateStart = pos
  view.setUint32(rec6PaintOffsetPos, translateStart - baseGlyphListOffset)
  view.setUint8(pos, 15); pos += 1 // format 15
  const childOffsetPos = pos; pos += 3
  view.setInt16(pos, 100); pos += 2 // dx
  view.setInt16(pos, 50); pos += 2 // dy
  view.setUint32(pos, 1); pos += 4 // varIndexBase
  writeOffset24(view, childOffsetPos, pos - translateStart)
  view.setUint8(pos, 2); pos += 1 // PaintSolid
  view.setUint16(pos, 1); pos += 2 // paletteIndex
  writeF2Dot14(view, pos, 1.0); pos += 2 // alpha

  // glyph 7: PaintVarLinearGradient with a var color line (1 stop)
  const gradStart = pos
  view.setUint32(rec7PaintOffsetPos, gradStart - baseGlyphListOffset)
  view.setUint8(pos, 5); pos += 1 // format 5
  const clOffsetPos = pos; pos += 3
  view.setInt16(pos, 0); pos += 2 // x0
  view.setInt16(pos, 0); pos += 2 // y0
  view.setInt16(pos, 100); pos += 2 // x1
  view.setInt16(pos, 0); pos += 2 // y1
  view.setInt16(pos, 0); pos += 2 // x2
  view.setInt16(pos, 100); pos += 2 // y2
  view.setUint32(pos, 3); pos += 4 // varIndexBase (x0..y2 → indices 3..8)
  writeOffset24(view, clOffsetPos, pos - gradStart)
  // VarColorLine: extend + numStops + VarColorStop
  view.setUint8(pos, 0); pos += 1 // extend PAD
  view.setUint16(pos, 1); pos += 2 // numStops
  writeF2Dot14(view, pos, 0.5); pos += 2 // stopOffset
  view.setUint16(pos, 2); pos += 2 // paletteIndex
  writeF2Dot14(view, pos, 1.0); pos += 2 // alpha
  view.setUint32(pos, 9); pos += 4 // varIndexBase (stopOffset → 9, alpha → 10)

  // ClipList: glyph 5, ClipBox format 2
  const clipListOffset = pos
  view.setUint32(clipListOffsetPos, clipListOffset)
  view.setUint8(pos, 1); pos += 1 // clipFormat 1
  view.setUint32(pos, 1); pos += 4 // numClips
  view.setUint16(pos, 5); pos += 2 // startGlyphID
  view.setUint16(pos, 5); pos += 2 // endGlyphID
  const clipBoxOffsetPos = pos; pos += 3
  writeOffset24(view, clipBoxOffsetPos, pos - clipListOffset)
  view.setUint8(pos, 2); pos += 1 // ClipBox format 2
  view.setInt16(pos, 0); pos += 2 // xMin
  view.setInt16(pos, -10); pos += 2 // yMin
  view.setInt16(pos, 500); pos += 2 // xMax
  view.setInt16(pos, 600); pos += 2 // yMax
  view.setUint32(pos, 11); pos += 4 // varIndexBase (xMin..yMax → 11..14)

  // VarIndexMap (optional)
  if (opts.varIndexMap) {
    view.setUint32(varIndexMapOffsetPos, pos)
    view.setUint8(pos, 0); pos += 1 // format 0
    view.setUint8(pos, 0x1F); pos += 1 // entryFormat: 2-byte entries, 16 inner bits
    view.setUint16(pos, opts.varIndexMap.length); pos += 2
    for (const inner of opts.varIndexMap) {
      view.setUint16(pos, inner); pos += 2
    }
  } else {
    view.setUint32(varIndexMapOffsetPos, 0)
  }

  // ItemVariationStore
  view.setUint32(ivsOffsetPos, pos)
  pos = writeIvs(view, pos, opts.deltas)

  return buf.slice(0, pos)
}

// Delta items (inner index → int16 delta):
//  0: alpha −0.5 (F2Dot14 −8192)
//  1: dx +30, 2: dy −20
//  3..8: gradient x0..y2 (+7, 0, −3, 0, 0, +11)
//  9: stopOffset +0.25 (4096), 10: stop alpha −0.75 (−12288, clamps at 0.25)
//  11..14: clip box (−10, +5, +15, +25)
const DELTAS = [-8192, 30, -20, 7, 0, -3, 0, 0, 11, 4096, -12288, -10, 5, 15, 25]

describe('COLR v1 ItemVariationStore', () => {
  it('returns unvaried values without coordinates', () => {
    const colr = parseColr(new BinaryReader(buildVarColr({ deltas: DELTAS })))
    const solid = colr.getPaintTree(5) as PaintSolid
    expect(solid.type).toBe('Solid')
    expect(solid.alpha).toBeCloseTo(1.0, 6)

    const translate = colr.getPaintTree(6) as PaintTranslate
    expect(translate.dx).toBe(100)
    expect(translate.dy).toBe(50)

    const clip = colr.getClipBox(5)!
    expect(clip.xMax).toBe(500)
  })

  it('applies deltas to PaintVarSolid alpha at peak coordinates', () => {
    const colr = parseColr(new BinaryReader(buildVarColr({ deltas: DELTAS })))
    const solid = colr.getPaintTree(5, [1.0]) as PaintSolid
    expect(solid.alpha).toBeCloseTo(0.5, 4)
  })

  it('scales deltas by the region scalar at intermediate coordinates', () => {
    const colr = parseColr(new BinaryReader(buildVarColr({ deltas: DELTAS })))
    // scalar 0.5 → delta round(−8192·0.5) = −4096 → alpha 0.75
    const solid = colr.getPaintTree(5, [0.5]) as PaintSolid
    expect(solid.alpha).toBeCloseTo(0.75, 4)
  })

  it('applies FWORD deltas to PaintVarTranslate and recurses into children', () => {
    const colr = parseColr(new BinaryReader(buildVarColr({ deltas: DELTAS })))
    const translate = colr.getPaintTree(6, [1.0]) as PaintTranslate
    expect(translate.dx).toBe(130)
    expect(translate.dy).toBe(30)
    const child = translate.paint as PaintSolid
    expect(child.type).toBe('Solid')
    expect(child.alpha).toBeCloseTo(1.0, 6) // non-var child unchanged
  })

  it('applies deltas to gradient geometry and var color stops (alpha clamped)', () => {
    const colr = parseColr(new BinaryReader(buildVarColr({ deltas: DELTAS })))
    const grad = colr.getPaintTree(7, [1.0]) as PaintLinearGradient
    expect(grad.x0).toBe(7) // 0 + 7
    expect(grad.x1).toBe(97) // 100 − 3
    expect(grad.y2).toBe(111) // 100 + 11
    const stop = grad.colorLine.stops[0]!
    expect(stop.stopOffset).toBeCloseTo(0.75, 4) // 0.5 + 0.25
    expect(stop.alpha).toBeCloseTo(0.25, 4) // 1.0 − 0.75
  })

  it('applies deltas to ClipBox format 2', () => {
    const colr = parseColr(new BinaryReader(buildVarColr({ deltas: DELTAS })))
    const clip = colr.getClipBox(5, [1.0])!
    expect(clip.xMin).toBe(-10) // 0 − 10
    expect(clip.yMin).toBe(-5) // −10 + 5
    expect(clip.xMax).toBe(515) // 500 + 15
    expect(clip.yMax).toBe(625) // 600 + 25
  })

  it('routes delta-set indices through the VarIndexMap when present', () => {
    // Map varIndex n → inner index: index 0 (solid alpha) remapped to item 9 (+4096 → +0.25, clamped to 1.0? no: 1.0+0.25 → clamp 1.0)
    // Use a distinct remap: index 0 → item 1 (delta 30 → alpha +30/16384)
    const map = [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    const colr = parseColr(new BinaryReader(buildVarColr({ deltas: DELTAS, varIndexMap: map })))
    const solid = colr.getPaintTree(5, [1.0]) as PaintSolid
    // alpha 1.0 + 30/16384, clamped to 1.0
    expect(solid.alpha).toBeCloseTo(1.0, 6)

    // Remap the translate deltas: varIndexBase 1 → map[1] = 1 (dx +30), map[2] = 2 (dy −20)
    const translate = colr.getPaintTree(6, [1.0]) as PaintTranslate
    expect(translate.dx).toBe(130)
    expect(translate.dy).toBe(30)
  })

  it('varied paint trees are cached per coordinate set', () => {
    const colr = parseColr(new BinaryReader(buildVarColr({ deltas: DELTAS })))
    const coords = [1.0]
    const a = colr.getPaintTree(5, coords)
    const b = colr.getPaintTree(5, coords)
    expect(b).toBe(a)
    const base = colr.getPaintTree(5)
    expect(base).not.toBe(a)
    expect((base as PaintSolid).alpha).toBeCloseTo(1.0, 6)
  })
})

describe('Font-level COLR variation (setVariation → getPaintTree)', () => {
  /** fvar with one wght axis 100..400..900 */
  function buildFvar(): Uint8Array {
    return buildTable(w => {
      w.writeUint16(1); w.writeUint16(0) // version
      w.writeUint16(16) // axesArrayOffset
      w.writeUint16(2) // reserved
      w.writeUint16(1) // axisCount
      w.writeUint16(20) // axisSize
      w.writeUint16(0) // instanceCount
      w.writeUint16(8) // instanceSize
      w.writeTag('wght')
      w.writeUint32(100 * 65536)
      w.writeUint32(400 * 65536)
      w.writeUint32(900 * 65536)
      w.writeUint16(0)
      w.writeUint16(256)
    })
  }

  it('applies COLR deltas at the current variation coordinates', () => {
    const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]]
    const glyphs = [null, ...Array.from({ length: 7 }, () => encodeSimpleGlyph(square, [3]))]
    const colrBytes = new Uint8Array(buildVarColr({ deltas: DELTAS }))
    const font = Font.load(buildTestFont(
      glyphs,
      [[0x41, 5]],
      [['COLR', colrBytes], ['fvar', buildFvar()]],
    ))

    // Default coordinates: unvaried alpha
    expect((font.getPaintTree(5) as PaintSolid).alpha).toBeCloseTo(1.0, 6)

    // wght 900 → normalized 1.0 → alpha delta −0.5
    font.setVariation({ wght: 900 })
    expect((font.getPaintTree(5) as PaintSolid).alpha).toBeCloseTo(0.5, 4)
    expect(font.getClipBox(5)!.xMax).toBe(515)

    // Back to default
    font.setVariation({})
    expect((font.getPaintTree(5) as PaintSolid).alpha).toBeCloseTo(1.0, 6)
  })

  it('rebuilds stable COLR v1 subsets with paint, clip, and variation semantics intact', () => {
    const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]]
    const glyphs = [null, ...Array.from({ length: 7 }, () => encodeSimpleGlyph(square, [3]))]
    const colrBytes = new Uint8Array(buildVarColr({ deltas: DELTAS }))
    const sourceBuffer = buildTestFont(
      glyphs,
      [[0x41, 5]],
      [['COLR', colrBytes], ['fvar', buildFvar()]],
    )
    const source = Font.load(sourceBuffer)
    const subsetBuffer = source.subsetPreservingTables('A').buffer
    const subset = Font.load(subsetBuffer)

    expect((subset.getPaintTree(5) as PaintSolid).alpha).toBeCloseTo(1, 6)
    expect(subset.getPaintTree(6)).toBeNull()
    expect(subset.getPaintTree(7)).toBeNull()
    expect(subset.getClipBox(5)).toMatchObject({ format: 2, xMax: 500, varIndexBase: 11 })
    subset.setVariation({ wght: 900 })
    expect((subset.getPaintTree(5) as PaintSolid).alpha).toBeCloseTo(0.5, 4)
    expect(subset.getClipBox(5)!.xMax).toBe(515)

    const sourceLength = parseFont(sourceBuffer).tableDirectory.get('COLR')!.length
    const subsetLength = parseFont(subsetBuffer).tableDirectory.get('COLR')!.length
    expect(subsetLength).toBeLessThan(sourceLength)
  })

  it('bakes the selected COLR v1 instance into non-variable compact paint records', () => {
    const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]]
    const glyphs = [null, ...Array.from({ length: 7 }, () => encodeSimpleGlyph(square, [3]))]
    const source = Font.load(buildTestFont(
      glyphs,
      [[0x41, 5]],
      [['COLR', new Uint8Array(buildVarColr({ deltas: DELTAS }))], ['fvar', buildFvar()]],
    ))
    source.setVariation({ wght: 900 })
    const result = source.subsetWithMapping('A')
    const subset = Font.load(result.buffer)
    const glyphId = result.oldToNewGlyphId.get(5)!

    expect(subset.isVariable).toBe(false)
    expect(subset.getPaintTree(glyphId)).toMatchObject({ type: 'Solid', format: 2, alpha: 0.5 })
    expect(subset.getClipBox(glyphId)).toMatchObject({ format: 1, xMin: -10, yMin: -5, xMax: 515, yMax: 625 })
  })
})
