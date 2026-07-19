import { BinaryReader } from '../../binary/reader.js'
import {
  parseItemVariationStore, parseDeltaSetIndexMap, getDelta,
  type ItemVariationStore, type DeltaSetIndexMap,
} from './variation-common.js'

/**
 * COLR table (v0 + v1): color glyph definitions
 * v0: BaseGlyphRecord + LayerRecord (flat layers)
 * v1: PaintNode tree (gradients, transforms, compositing, etc.)
 * v1 variation: ItemVariationStore + VarIndexMap deltas applied to
 * PaintVar* values when normalized coordinates are supplied
 */

// ── v0 Types ──

export interface ColorLayer {
  glyphId: number
  paletteIndex: number
}

// ── v1 Types ──

export const enum ExtendMode {
  PAD = 0,
  REPEAT = 1,
  REFLECT = 2,
}

export const enum CompositeMode {
  CLEAR = 0,
  SRC = 1,
  DEST = 2,
  SRC_OVER = 3,
  DEST_OVER = 4,
  SRC_IN = 5,
  DEST_IN = 6,
  SRC_OUT = 7,
  DEST_OUT = 8,
  SRC_ATOP = 9,
  DEST_ATOP = 10,
  XOR = 11,
  PLUS = 12,
  SCREEN = 13,
  OVERLAY = 14,
  DARKEN = 15,
  LIGHTEN = 16,
  COLOR_DODGE = 17,
  COLOR_BURN = 18,
  HARD_LIGHT = 19,
  SOFT_LIGHT = 20,
  DIFFERENCE = 21,
  EXCLUSION = 22,
  MULTIPLY = 23,
  HUE = 24,
  SATURATION = 25,
  COLOR = 26,
  LUMINOSITY = 27,
}

export interface ColorStop {
  stopOffset: number
  paletteIndex: number
  alpha: number
  varIndexBase?: number
}

export interface ColorLine {
  extend: ExtendMode
  stops: ColorStop[]
}

export interface Affine2x3 {
  xx: number
  yx: number
  xy: number
  yy: number
  dx: number
  dy: number
}

export interface ClipBox {
  format: 1 | 2
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  varIndexBase?: number
}

// ── Paint Node (discriminated union) ──

export type PaintNode =
  | PaintColrLayers
  | PaintSolid
  | PaintLinearGradient
  | PaintRadialGradient
  | PaintSweepGradient
  | PaintGlyph
  | PaintColrGlyph
  | PaintTransform
  | PaintTranslate
  | PaintScale
  | PaintScaleAroundCenter
  | PaintScaleUniform
  | PaintScaleUniformAroundCenter
  | PaintRotate
  | PaintRotateAroundCenter
  | PaintSkew
  | PaintSkewAroundCenter
  | PaintComposite

export interface PaintColrLayers {
  type: 'ColrLayers'
  format: 1
  layers: PaintNode[]
}

export interface PaintSolid {
  type: 'Solid'
  format: 2 | 3
  paletteIndex: number
  alpha: number
  varIndexBase?: number
}

export interface PaintLinearGradient {
  type: 'LinearGradient'
  format: 4 | 5
  colorLine: ColorLine
  x0: number
  y0: number
  x1: number
  y1: number
  x2: number
  y2: number
  varIndexBase?: number
}

export interface PaintRadialGradient {
  type: 'RadialGradient'
  format: 6 | 7
  colorLine: ColorLine
  x0: number
  y0: number
  r0: number
  x1: number
  y1: number
  r1: number
  varIndexBase?: number
}

export interface PaintSweepGradient {
  type: 'SweepGradient'
  format: 8 | 9
  colorLine: ColorLine
  centerX: number
  centerY: number
  startAngle: number
  endAngle: number
  varIndexBase?: number
}

export interface PaintGlyph {
  type: 'Glyph'
  format: 10
  paint: PaintNode
  glyphId: number
}

export interface PaintColrGlyph {
  type: 'ColrGlyph'
  format: 11
  glyphId: number
}

export interface PaintTransform {
  type: 'Transform'
  format: 12 | 13
  paint: PaintNode
  transform: Affine2x3
  varIndexBase?: number
}

export interface PaintTranslate {
  type: 'Translate'
  format: 14 | 15
  paint: PaintNode
  dx: number
  dy: number
  varIndexBase?: number
}

export interface PaintScale {
  type: 'Scale'
  format: 16 | 17
  paint: PaintNode
  scaleX: number
  scaleY: number
  varIndexBase?: number
}

export interface PaintScaleAroundCenter {
  type: 'ScaleAroundCenter'
  format: 18 | 19
  paint: PaintNode
  scaleX: number
  scaleY: number
  centerX: number
  centerY: number
  varIndexBase?: number
}

export interface PaintScaleUniform {
  type: 'ScaleUniform'
  format: 20 | 21
  paint: PaintNode
  scale: number
  varIndexBase?: number
}

export interface PaintScaleUniformAroundCenter {
  type: 'ScaleUniformAroundCenter'
  format: 22 | 23
  paint: PaintNode
  scale: number
  centerX: number
  centerY: number
  varIndexBase?: number
}

export interface PaintRotate {
  type: 'Rotate'
  format: 24 | 25
  paint: PaintNode
  angle: number
  varIndexBase?: number
}

export interface PaintRotateAroundCenter {
  type: 'RotateAroundCenter'
  format: 26 | 27
  paint: PaintNode
  angle: number
  centerX: number
  centerY: number
  varIndexBase?: number
}

export interface PaintSkew {
  type: 'Skew'
  format: 28 | 29
  paint: PaintNode
  xSkewAngle: number
  ySkewAngle: number
  varIndexBase?: number
}

export interface PaintSkewAroundCenter {
  type: 'SkewAroundCenter'
  format: 30 | 31
  paint: PaintNode
  xSkewAngle: number
  ySkewAngle: number
  centerX: number
  centerY: number
  varIndexBase?: number
}

export interface PaintComposite {
  type: 'Composite'
  format: 32
  source: PaintNode
  compositeMode: CompositeMode
  backdrop: PaintNode
}

// ── Table Interface ──

export interface ColrTable {
  version: number
  getColorLayers(glyphId: number): ColorLayer[] | null
  /**
   * Gets the paint tree for a glyph.
   * When normalized variation coordinates are given, ItemVariationStore
   * deltas are applied to all PaintVar* values (alpha, gradient geometry,
   * color stops, transform components, angles).
   */
  getPaintTree(glyphId: number, coords?: number[] | null): PaintNode | null
  /**
   * Gets the clip box for a glyph.
   * When normalized variation coordinates are given, format-2 clip box
   * deltas are applied.
   */
  getClipBox(glyphId: number, coords?: number[] | null): ClipBox | null
}

// ── Helpers ──

function readOffset24(reader: BinaryReader): number {
  const b0 = reader.readUint8()
  const b1 = reader.readUint8()
  const b2 = reader.readUint8()
  return (b0 << 16) | (b1 << 8) | b2
}

function parseColorLine(reader: BinaryReader, absOffset: number, isVar: boolean): ColorLine {
  reader.seek(absOffset)
  const extend = reader.readUint8() as ExtendMode
  const numStops = reader.readUint16()
  const stops: ColorStop[] = []
  for (let i = 0; i < numStops; i++) {
    const stopOffset = reader.readF2Dot14()
    const paletteIndex = reader.readUint16()
    const alpha = reader.readF2Dot14()
    const varIndexBase = isVar ? reader.readUint32() : undefined
    stops.push({ stopOffset, paletteIndex, alpha, varIndexBase })
  }
  return { extend, stops }
}

function parseAffine2x3(reader: BinaryReader): Affine2x3 {
  const xx = reader.readFixed()
  const yx = reader.readFixed()
  const xy = reader.readFixed()
  const yy = reader.readFixed()
  const dx = reader.readFixed()
  const dy = reader.readFixed()
  return { xx, yx, xy, yy, dx, dy }
}

// ── Paint Parser ──

function parsePaint(
  reader: BinaryReader,
  offset: number,
  layerPaints: PaintNode[] | null,
  visited: Set<number>,
): PaintNode {
  if (visited.has(offset)) {
    throw new Error(`COLR v1: cyclic paint reference at offset ${offset}`)
  }
  visited.add(offset)

  reader.seek(offset)
  const format = reader.readUint8()

  function child(off: number): PaintNode {
    return parsePaint(reader, off, layerPaints, visited)
  }

  let node: PaintNode

  switch (format) {
    case 1: { // PaintColrLayers
      const numLayers = reader.readUint8()
      const firstLayerIndex = reader.readUint32()
      const layers: PaintNode[] = []
      if (layerPaints) {
        for (let i = 0; i < numLayers; i++) {
          const idx = firstLayerIndex + i
          if (idx < layerPaints.length) {
            layers.push(layerPaints[idx]!)
          }
        }
      }
      node = { type: 'ColrLayers', format: 1, layers }
      break
    }

    case 2: { // PaintSolid
      const paletteIndex = reader.readUint16()
      const alpha = reader.readF2Dot14()
      node = { type: 'Solid', format: 2, paletteIndex, alpha }
      break
    }

    case 3: { // PaintVarSolid
      const paletteIndex = reader.readUint16()
      const alpha = reader.readF2Dot14()
      const varIndexBase = reader.readUint32()
      node = { type: 'Solid', format: 3, paletteIndex, alpha, varIndexBase }
      break
    }

    case 4: { // PaintLinearGradient
      const clOff = readOffset24(reader)
      const x0 = reader.readInt16()
      const y0 = reader.readInt16()
      const x1 = reader.readInt16()
      const y1 = reader.readInt16()
      const x2 = reader.readInt16()
      const y2 = reader.readInt16()
      const colorLine = parseColorLine(reader, offset + clOff, false)
      node = { type: 'LinearGradient', format: 4, colorLine, x0, y0, x1, y1, x2, y2 }
      break
    }

    case 5: { // PaintVarLinearGradient
      const clOff = readOffset24(reader)
      const x0 = reader.readInt16()
      const y0 = reader.readInt16()
      const x1 = reader.readInt16()
      const y1 = reader.readInt16()
      const x2 = reader.readInt16()
      const y2 = reader.readInt16()
      const varIndexBase = reader.readUint32()
      const colorLine = parseColorLine(reader, offset + clOff, true)
      node = { type: 'LinearGradient', format: 5, colorLine, x0, y0, x1, y1, x2, y2, varIndexBase }
      break
    }

    case 6: { // PaintRadialGradient
      const clOff = readOffset24(reader)
      const x0 = reader.readInt16()
      const y0 = reader.readInt16()
      const r0 = reader.readUint16()
      const x1 = reader.readInt16()
      const y1 = reader.readInt16()
      const r1 = reader.readUint16()
      const colorLine = parseColorLine(reader, offset + clOff, false)
      node = { type: 'RadialGradient', format: 6, colorLine, x0, y0, r0, x1, y1, r1 }
      break
    }

    case 7: { // PaintVarRadialGradient
      const clOff = readOffset24(reader)
      const x0 = reader.readInt16()
      const y0 = reader.readInt16()
      const r0 = reader.readUint16()
      const x1 = reader.readInt16()
      const y1 = reader.readInt16()
      const r1 = reader.readUint16()
      const varIndexBase = reader.readUint32()
      const colorLine = parseColorLine(reader, offset + clOff, true)
      node = { type: 'RadialGradient', format: 7, colorLine, x0, y0, r0, x1, y1, r1, varIndexBase }
      break
    }

    case 8: { // PaintSweepGradient
      const clOff = readOffset24(reader)
      const centerX = reader.readInt16()
      const centerY = reader.readInt16()
      const startAngle = reader.readF2Dot14()
      const endAngle = reader.readF2Dot14()
      const colorLine = parseColorLine(reader, offset + clOff, false)
      node = { type: 'SweepGradient', format: 8, colorLine, centerX, centerY, startAngle, endAngle }
      break
    }

    case 9: { // PaintVarSweepGradient
      const clOff = readOffset24(reader)
      const centerX = reader.readInt16()
      const centerY = reader.readInt16()
      const startAngle = reader.readF2Dot14()
      const endAngle = reader.readF2Dot14()
      const varIndexBase = reader.readUint32()
      const colorLine = parseColorLine(reader, offset + clOff, true)
      node = { type: 'SweepGradient', format: 9, colorLine, centerX, centerY, startAngle, endAngle, varIndexBase }
      break
    }

    case 10: { // PaintGlyph
      const paintOff = readOffset24(reader)
      const glyphId = reader.readUint16()
      const paint = child(offset + paintOff)
      node = { type: 'Glyph', format: 10, paint, glyphId }
      break
    }

    case 11: { // PaintColrGlyph
      const glyphId = reader.readUint16()
      node = { type: 'ColrGlyph', format: 11, glyphId }
      break
    }

    case 12: { // PaintTransform
      const paintOff = readOffset24(reader)
      const transformOff = readOffset24(reader)
      reader.seek(offset + transformOff)
      const transform = parseAffine2x3(reader)
      const paint = child(offset + paintOff)
      node = { type: 'Transform', format: 12, paint, transform }
      break
    }

    case 13: { // PaintVarTransform
      const paintOff = readOffset24(reader)
      const transformOff = readOffset24(reader)
      reader.seek(offset + transformOff)
      const transform = parseAffine2x3(reader)
      const varIndexBase = reader.readUint32()
      const paint = child(offset + paintOff)
      node = { type: 'Transform', format: 13, paint, transform, varIndexBase }
      break
    }

    case 14: { // PaintTranslate
      const paintOff = readOffset24(reader)
      const dx = reader.readFWord()
      const dy = reader.readFWord()
      const paint = child(offset + paintOff)
      node = { type: 'Translate', format: 14, paint, dx, dy }
      break
    }

    case 15: { // PaintVarTranslate
      const paintOff = readOffset24(reader)
      const dx = reader.readFWord()
      const dy = reader.readFWord()
      const varIndexBase = reader.readUint32()
      const paint = child(offset + paintOff)
      node = { type: 'Translate', format: 15, paint, dx, dy, varIndexBase }
      break
    }

    case 16: { // PaintScale
      const paintOff = readOffset24(reader)
      const scaleX = reader.readF2Dot14()
      const scaleY = reader.readF2Dot14()
      const paint = child(offset + paintOff)
      node = { type: 'Scale', format: 16, paint, scaleX, scaleY }
      break
    }

    case 17: { // PaintVarScale
      const paintOff = readOffset24(reader)
      const scaleX = reader.readF2Dot14()
      const scaleY = reader.readF2Dot14()
      const varIndexBase = reader.readUint32()
      const paint = child(offset + paintOff)
      node = { type: 'Scale', format: 17, paint, scaleX, scaleY, varIndexBase }
      break
    }

    case 18: { // PaintScaleAroundCenter
      const paintOff = readOffset24(reader)
      const scaleX = reader.readF2Dot14()
      const scaleY = reader.readF2Dot14()
      const centerX = reader.readFWord()
      const centerY = reader.readFWord()
      const paint = child(offset + paintOff)
      node = { type: 'ScaleAroundCenter', format: 18, paint, scaleX, scaleY, centerX, centerY }
      break
    }

    case 19: { // PaintVarScaleAroundCenter
      const paintOff = readOffset24(reader)
      const scaleX = reader.readF2Dot14()
      const scaleY = reader.readF2Dot14()
      const centerX = reader.readFWord()
      const centerY = reader.readFWord()
      const varIndexBase = reader.readUint32()
      const paint = child(offset + paintOff)
      node = { type: 'ScaleAroundCenter', format: 19, paint, scaleX, scaleY, centerX, centerY, varIndexBase }
      break
    }

    case 20: { // PaintScaleUniform
      const paintOff = readOffset24(reader)
      const scale = reader.readF2Dot14()
      const paint = child(offset + paintOff)
      node = { type: 'ScaleUniform', format: 20, paint, scale }
      break
    }

    case 21: { // PaintVarScaleUniform
      const paintOff = readOffset24(reader)
      const scale = reader.readF2Dot14()
      const varIndexBase = reader.readUint32()
      const paint = child(offset + paintOff)
      node = { type: 'ScaleUniform', format: 21, paint, scale, varIndexBase }
      break
    }

    case 22: { // PaintScaleUniformAroundCenter
      const paintOff = readOffset24(reader)
      const scale = reader.readF2Dot14()
      const centerX = reader.readFWord()
      const centerY = reader.readFWord()
      const paint = child(offset + paintOff)
      node = { type: 'ScaleUniformAroundCenter', format: 22, paint, scale, centerX, centerY }
      break
    }

    case 23: { // PaintVarScaleUniformAroundCenter
      const paintOff = readOffset24(reader)
      const scale = reader.readF2Dot14()
      const centerX = reader.readFWord()
      const centerY = reader.readFWord()
      const varIndexBase = reader.readUint32()
      const paint = child(offset + paintOff)
      node = { type: 'ScaleUniformAroundCenter', format: 23, paint, scale, centerX, centerY, varIndexBase }
      break
    }

    case 24: { // PaintRotate
      const paintOff = readOffset24(reader)
      const angle = reader.readF2Dot14()
      const paint = child(offset + paintOff)
      node = { type: 'Rotate', format: 24, paint, angle }
      break
    }

    case 25: { // PaintVarRotate
      const paintOff = readOffset24(reader)
      const angle = reader.readF2Dot14()
      const varIndexBase = reader.readUint32()
      const paint = child(offset + paintOff)
      node = { type: 'Rotate', format: 25, paint, angle, varIndexBase }
      break
    }

    case 26: { // PaintRotateAroundCenter
      const paintOff = readOffset24(reader)
      const angle = reader.readF2Dot14()
      const centerX = reader.readFWord()
      const centerY = reader.readFWord()
      const paint = child(offset + paintOff)
      node = { type: 'RotateAroundCenter', format: 26, paint, angle, centerX, centerY }
      break
    }

    case 27: { // PaintVarRotateAroundCenter
      const paintOff = readOffset24(reader)
      const angle = reader.readF2Dot14()
      const centerX = reader.readFWord()
      const centerY = reader.readFWord()
      const varIndexBase = reader.readUint32()
      const paint = child(offset + paintOff)
      node = { type: 'RotateAroundCenter', format: 27, paint, angle, centerX, centerY, varIndexBase }
      break
    }

    case 28: { // PaintSkew
      const paintOff = readOffset24(reader)
      const xSkewAngle = reader.readF2Dot14()
      const ySkewAngle = reader.readF2Dot14()
      const paint = child(offset + paintOff)
      node = { type: 'Skew', format: 28, paint, xSkewAngle, ySkewAngle }
      break
    }

    case 29: { // PaintVarSkew
      const paintOff = readOffset24(reader)
      const xSkewAngle = reader.readF2Dot14()
      const ySkewAngle = reader.readF2Dot14()
      const varIndexBase = reader.readUint32()
      const paint = child(offset + paintOff)
      node = { type: 'Skew', format: 29, paint, xSkewAngle, ySkewAngle, varIndexBase }
      break
    }

    case 30: { // PaintSkewAroundCenter
      const paintOff = readOffset24(reader)
      const xSkewAngle = reader.readF2Dot14()
      const ySkewAngle = reader.readF2Dot14()
      const centerX = reader.readFWord()
      const centerY = reader.readFWord()
      const paint = child(offset + paintOff)
      node = { type: 'SkewAroundCenter', format: 30, paint, xSkewAngle, ySkewAngle, centerX, centerY }
      break
    }

    case 31: { // PaintVarSkewAroundCenter
      const paintOff = readOffset24(reader)
      const xSkewAngle = reader.readF2Dot14()
      const ySkewAngle = reader.readF2Dot14()
      const centerX = reader.readFWord()
      const centerY = reader.readFWord()
      const varIndexBase = reader.readUint32()
      const paint = child(offset + paintOff)
      node = { type: 'SkewAroundCenter', format: 31, paint, xSkewAngle, ySkewAngle, centerX, centerY, varIndexBase }
      break
    }

    case 32: { // PaintComposite
      const sourceOff = readOffset24(reader)
      const compositeMode = reader.readUint8() as CompositeMode
      const backdropOff = readOffset24(reader)
      const source = child(offset + sourceOff)
      const backdrop = child(offset + backdropOff)
      node = { type: 'Composite', format: 32, source, compositeMode, backdrop }
      break
    }

    default:
      throw new Error(`COLR v1: unknown paint format ${format} at offset ${offset}`)
  }

  visited.delete(offset)
  return node
}

// ── v1 Variation (ItemVariationStore) ──

/** Sentinel varIndexBase meaning "no variation data" */
const NO_VARIATION_INDEX = 0xFFFFFFFF

/** F2Dot14 delta scale (stopOffset, alpha, scale factors, angles) */
const F2DOT14_SCALE = 1 / 16384
/** Fixed 16.16 delta scale (Affine2x3 components) */
const FIXED_SCALE = 1 / 65536

interface ColrVariationContext {
  ivs: ItemVariationStore
  varIndexMap: DeltaSetIndexMap | null
  coords: number[]
}

/**
 * Resolves the delta for (varIndexBase + offset).
 * The delta-set index is looked up through the VarIndexMap when present;
 * otherwise the index is split directly into outer (high 16 bits) and
 * inner (low 16 bits) indices per the OpenType VarIdx convention.
 */
function colrDelta(ctx: ColrVariationContext, varIndexBase: number | undefined, offset: number): number {
  if (varIndexBase === undefined || varIndexBase === NO_VARIATION_INDEX) return 0
  const idx = varIndexBase + offset
  let outer: number
  let inner: number
  if (ctx.varIndexMap) {
    const entries = ctx.varIndexMap.entries
    if (idx >= entries.length) return 0
    const e = entries[idx]!
    outer = e.outer
    inner = e.inner
  } else {
    outer = idx >>> 16
    inner = idx & 0xFFFF
  }
  return getDelta(ctx.ivs, outer, inner, ctx.coords)
}

function clampUnit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Applies variation deltas to a ColorLine (per-stop varIndexBase) */
function applyColorLineVariation(ctx: ColrVariationContext, colorLine: ColorLine): ColorLine {
  const srcStops = colorLine.stops
  const stops: ColorStop[] = new Array(srcStops.length)
  for (let i = 0; i < srcStops.length; i++) {
    const s = srcStops[i]!
    stops[i] = {
      stopOffset: s.stopOffset + colrDelta(ctx, s.varIndexBase, 0) * F2DOT14_SCALE,
      paletteIndex: s.paletteIndex,
      alpha: clampUnit(s.alpha + colrDelta(ctx, s.varIndexBase, 1) * F2DOT14_SCALE),
      varIndexBase: s.varIndexBase,
    }
  }
  return { extend: colorLine.extend, stops }
}

/**
 * Applies variation deltas to a paint tree, returning a new tree.
 * Delta-set indices are contiguous per PaintVar* record starting at its
 * varIndexBase, in the field order defined by the COLR v1 specification.
 */
function applyPaintVariation(ctx: ColrVariationContext, node: PaintNode): PaintNode {
  switch (node.type) {
    case 'ColrLayers': {
      const layers: PaintNode[] = new Array(node.layers.length)
      for (let i = 0; i < node.layers.length; i++) {
        layers[i] = applyPaintVariation(ctx, node.layers[i]!)
      }
      return { type: 'ColrLayers', format: 1, layers }
    }

    case 'Solid':
      return {
        type: 'Solid', format: node.format,
        paletteIndex: node.paletteIndex,
        alpha: clampUnit(node.alpha + colrDelta(ctx, node.varIndexBase, 0) * F2DOT14_SCALE),
        varIndexBase: node.varIndexBase,
      }

    case 'LinearGradient':
      return {
        type: 'LinearGradient', format: node.format,
        colorLine: applyColorLineVariation(ctx, node.colorLine),
        x0: node.x0 + colrDelta(ctx, node.varIndexBase, 0),
        y0: node.y0 + colrDelta(ctx, node.varIndexBase, 1),
        x1: node.x1 + colrDelta(ctx, node.varIndexBase, 2),
        y1: node.y1 + colrDelta(ctx, node.varIndexBase, 3),
        x2: node.x2 + colrDelta(ctx, node.varIndexBase, 4),
        y2: node.y2 + colrDelta(ctx, node.varIndexBase, 5),
        varIndexBase: node.varIndexBase,
      }

    case 'RadialGradient':
      return {
        type: 'RadialGradient', format: node.format,
        colorLine: applyColorLineVariation(ctx, node.colorLine),
        x0: node.x0 + colrDelta(ctx, node.varIndexBase, 0),
        y0: node.y0 + colrDelta(ctx, node.varIndexBase, 1),
        r0: node.r0 + colrDelta(ctx, node.varIndexBase, 2),
        x1: node.x1 + colrDelta(ctx, node.varIndexBase, 3),
        y1: node.y1 + colrDelta(ctx, node.varIndexBase, 4),
        r1: node.r1 + colrDelta(ctx, node.varIndexBase, 5),
        varIndexBase: node.varIndexBase,
      }

    case 'SweepGradient':
      return {
        type: 'SweepGradient', format: node.format,
        colorLine: applyColorLineVariation(ctx, node.colorLine),
        centerX: node.centerX + colrDelta(ctx, node.varIndexBase, 0),
        centerY: node.centerY + colrDelta(ctx, node.varIndexBase, 1),
        startAngle: node.startAngle + colrDelta(ctx, node.varIndexBase, 2) * F2DOT14_SCALE,
        endAngle: node.endAngle + colrDelta(ctx, node.varIndexBase, 3) * F2DOT14_SCALE,
        varIndexBase: node.varIndexBase,
      }

    case 'Glyph':
      return {
        type: 'Glyph', format: 10,
        paint: applyPaintVariation(ctx, node.paint),
        glyphId: node.glyphId,
      }

    case 'ColrGlyph':
      // Resolved through getPaintTree at render time (deltas applied there)
      return node

    case 'Transform': {
      const t = node.transform
      return {
        type: 'Transform', format: node.format,
        paint: applyPaintVariation(ctx, node.paint),
        transform: {
          xx: t.xx + colrDelta(ctx, node.varIndexBase, 0) * FIXED_SCALE,
          yx: t.yx + colrDelta(ctx, node.varIndexBase, 1) * FIXED_SCALE,
          xy: t.xy + colrDelta(ctx, node.varIndexBase, 2) * FIXED_SCALE,
          yy: t.yy + colrDelta(ctx, node.varIndexBase, 3) * FIXED_SCALE,
          dx: t.dx + colrDelta(ctx, node.varIndexBase, 4) * FIXED_SCALE,
          dy: t.dy + colrDelta(ctx, node.varIndexBase, 5) * FIXED_SCALE,
        },
        varIndexBase: node.varIndexBase,
      }
    }

    case 'Translate':
      return {
        type: 'Translate', format: node.format,
        paint: applyPaintVariation(ctx, node.paint),
        dx: node.dx + colrDelta(ctx, node.varIndexBase, 0),
        dy: node.dy + colrDelta(ctx, node.varIndexBase, 1),
        varIndexBase: node.varIndexBase,
      }

    case 'Scale':
      return {
        type: 'Scale', format: node.format,
        paint: applyPaintVariation(ctx, node.paint),
        scaleX: node.scaleX + colrDelta(ctx, node.varIndexBase, 0) * F2DOT14_SCALE,
        scaleY: node.scaleY + colrDelta(ctx, node.varIndexBase, 1) * F2DOT14_SCALE,
        varIndexBase: node.varIndexBase,
      }

    case 'ScaleAroundCenter':
      return {
        type: 'ScaleAroundCenter', format: node.format,
        paint: applyPaintVariation(ctx, node.paint),
        scaleX: node.scaleX + colrDelta(ctx, node.varIndexBase, 0) * F2DOT14_SCALE,
        scaleY: node.scaleY + colrDelta(ctx, node.varIndexBase, 1) * F2DOT14_SCALE,
        centerX: node.centerX + colrDelta(ctx, node.varIndexBase, 2),
        centerY: node.centerY + colrDelta(ctx, node.varIndexBase, 3),
        varIndexBase: node.varIndexBase,
      }

    case 'ScaleUniform':
      return {
        type: 'ScaleUniform', format: node.format,
        paint: applyPaintVariation(ctx, node.paint),
        scale: node.scale + colrDelta(ctx, node.varIndexBase, 0) * F2DOT14_SCALE,
        varIndexBase: node.varIndexBase,
      }

    case 'ScaleUniformAroundCenter':
      return {
        type: 'ScaleUniformAroundCenter', format: node.format,
        paint: applyPaintVariation(ctx, node.paint),
        scale: node.scale + colrDelta(ctx, node.varIndexBase, 0) * F2DOT14_SCALE,
        centerX: node.centerX + colrDelta(ctx, node.varIndexBase, 1),
        centerY: node.centerY + colrDelta(ctx, node.varIndexBase, 2),
        varIndexBase: node.varIndexBase,
      }

    case 'Rotate':
      return {
        type: 'Rotate', format: node.format,
        paint: applyPaintVariation(ctx, node.paint),
        angle: node.angle + colrDelta(ctx, node.varIndexBase, 0) * F2DOT14_SCALE,
        varIndexBase: node.varIndexBase,
      }

    case 'RotateAroundCenter':
      return {
        type: 'RotateAroundCenter', format: node.format,
        paint: applyPaintVariation(ctx, node.paint),
        angle: node.angle + colrDelta(ctx, node.varIndexBase, 0) * F2DOT14_SCALE,
        centerX: node.centerX + colrDelta(ctx, node.varIndexBase, 1),
        centerY: node.centerY + colrDelta(ctx, node.varIndexBase, 2),
        varIndexBase: node.varIndexBase,
      }

    case 'Skew':
      return {
        type: 'Skew', format: node.format,
        paint: applyPaintVariation(ctx, node.paint),
        xSkewAngle: node.xSkewAngle + colrDelta(ctx, node.varIndexBase, 0) * F2DOT14_SCALE,
        ySkewAngle: node.ySkewAngle + colrDelta(ctx, node.varIndexBase, 1) * F2DOT14_SCALE,
        varIndexBase: node.varIndexBase,
      }

    case 'SkewAroundCenter':
      return {
        type: 'SkewAroundCenter', format: node.format,
        paint: applyPaintVariation(ctx, node.paint),
        xSkewAngle: node.xSkewAngle + colrDelta(ctx, node.varIndexBase, 0) * F2DOT14_SCALE,
        ySkewAngle: node.ySkewAngle + colrDelta(ctx, node.varIndexBase, 1) * F2DOT14_SCALE,
        centerX: node.centerX + colrDelta(ctx, node.varIndexBase, 2),
        centerY: node.centerY + colrDelta(ctx, node.varIndexBase, 3),
        varIndexBase: node.varIndexBase,
      }

    case 'Composite':
      return {
        type: 'Composite', format: 32,
        source: applyPaintVariation(ctx, node.source),
        compositeMode: node.compositeMode,
        backdrop: applyPaintVariation(ctx, node.backdrop),
      }
  }
}

/** Applies variation deltas to a format-2 clip box */
function applyClipBoxVariation(ctx: ColrVariationContext, box: ClipBox): ClipBox {
  if (box.format !== 2) return box
  return {
    format: 2,
    xMin: box.xMin + colrDelta(ctx, box.varIndexBase, 0),
    yMin: box.yMin + colrDelta(ctx, box.varIndexBase, 1),
    xMax: box.xMax + colrDelta(ctx, box.varIndexBase, 2),
    yMax: box.yMax + colrDelta(ctx, box.varIndexBase, 3),
    varIndexBase: box.varIndexBase,
  }
}

// ── ClipList Parser ──

function parseClipList(reader: BinaryReader, absOffset: number): Map<number, ClipBox> {
  const clipMap = new Map<number, ClipBox>()
  reader.seek(absOffset)

  const clipFormat = reader.readUint8()
  if (clipFormat !== 1 && clipFormat !== 2) return clipMap

  const numClips = reader.readUint32()
  const clips: { startGlyphID: number, endGlyphID: number, clipBoxOffset: number }[] = []
  for (let i = 0; i < numClips; i++) {
    const startGlyphID = reader.readUint16()
    const endGlyphID = reader.readUint16()
    const clipBoxOffset = readOffset24(reader)
    clips.push({ startGlyphID, endGlyphID, clipBoxOffset })
  }

  for (const clip of clips) {
    reader.seek(absOffset + clip.clipBoxOffset)
    const boxFormat = reader.readUint8()
    const xMin = reader.readInt16()
    const yMin = reader.readInt16()
    const xMax = reader.readInt16()
    const yMax = reader.readInt16()
    const varIndexBase = boxFormat === 2 ? reader.readUint32() : undefined
    const box: ClipBox = { format: boxFormat as 1 | 2, xMin, yMin, xMax, yMax, varIndexBase }
    for (let g = clip.startGlyphID; g <= clip.endGlyphID; g++) {
      clipMap.set(g, box)
    }
  }

  return clipMap
}

// ── Main Parser ──

export function parseColr(reader: BinaryReader): ColrTable {
  const version = reader.readUint16()
  const numBaseGlyphRecords = reader.readUint16()
  const baseGlyphRecordsOffset = reader.readUint32()
  const layerRecordsOffset = reader.readUint32()
  const numLayerRecords = reader.readUint16()

  // v0: BaseGlyphRecord → (firstLayerIndex, numLayers)
  const baseGlyphsV0 = new Map<number, { firstLayerIndex: number, numLayers: number }>()
  if (numBaseGlyphRecords > 0 && baseGlyphRecordsOffset > 0) {
    reader.seek(baseGlyphRecordsOffset)
    for (let i = 0; i < numBaseGlyphRecords; i++) {
      const glyphId = reader.readUint16()
      const firstLayerIndex = reader.readUint16()
      const numLayers = reader.readUint16()
      baseGlyphsV0.set(glyphId, { firstLayerIndex, numLayers })
    }
  }

  // v0: LayerRecord array
  const layersV0: ColorLayer[] = []
  if (numLayerRecords > 0 && layerRecordsOffset > 0) {
    reader.seek(layerRecordsOffset)
    for (let i = 0; i < numLayerRecords; i++) {
      const glyphId = reader.readUint16()
      const paletteIndex = reader.readUint16()
      layersV0.push({ glyphId, paletteIndex })
    }
  }

  // v1 fields
  let baseGlyphPaintsV1: Map<number, number> | null = null
  let layerPaints: PaintNode[] | null = null
  let clipBoxes: Map<number, ClipBox> | null = null
  let baseGlyphListOffset = 0
  let itemVariationStore: ItemVariationStore | null = null
  let varIndexMap: DeltaSetIndexMap | null = null

  if (version >= 1) {
    // v1 header continuation (after the 14-byte v0 header)
    reader.seek(14)
    const baseGlyphListOff = reader.readUint32()
    const layerListOff = reader.readUint32()
    const clipListOff = reader.readUint32()
    const varIndexMapOff = reader.readUint32()
    const itemVariationStoreOff = reader.readUint32()

    // Variation data (deltas for PaintVar* / VarColorStop / ClipBoxFormat2)
    if (itemVariationStoreOff > 0) {
      itemVariationStore = parseItemVariationStore(reader, itemVariationStoreOff)
    }
    if (varIndexMapOff > 0) {
      varIndexMap = parseDeltaSetIndexMap(reader, varIndexMapOff)
    }

    // Parse LayerList first (needed by PaintColrLayers)
    let layerListAbsOffset = 0
    if (layerListOff > 0) {
      layerListAbsOffset = layerListOff
      reader.seek(layerListAbsOffset)
      const numLayers = reader.readUint32()
      const layerPaintOffsets: number[] = []
      for (let i = 0; i < numLayers; i++) {
        layerPaintOffsets.push(reader.readUint32())
      }
      // Parse layer paints (layers cannot reference other layers via PaintColrLayers to avoid cycles)
      layerPaints = []
      for (const off of layerPaintOffsets) {
        const paint = parsePaint(reader, layerListAbsOffset + off, null, new Set())
        layerPaints.push(paint)
      }
    }

    // Parse BaseGlyphList (v1)
    if (baseGlyphListOff > 0) {
      baseGlyphListOffset = baseGlyphListOff
      reader.seek(baseGlyphListOffset)
      const numRecords = reader.readUint32()
      baseGlyphPaintsV1 = new Map()
      for (let i = 0; i < numRecords; i++) {
        const glyphId = reader.readUint16()
        const paintOffset = reader.readUint32()
        baseGlyphPaintsV1.set(glyphId, paintOffset)
      }
    }

    // Parse ClipList
    if (clipListOff > 0) {
      clipBoxes = parseClipList(reader, clipListOff)
    }
  }

  // Cache for v1 paint trees
  const paintTreeCache = new Map<number, PaintNode | null>()
  // Cache for varied paint trees; invalidated when the coords array changes
  const variedPaintTreeCache = new Map<number, PaintNode | null>()
  let variedCacheCoords: number[] | null = null

  function getBasePaintTree(glyphId: number): PaintNode | null {
    if (!baseGlyphPaintsV1) return null
    if (paintTreeCache.has(glyphId)) return paintTreeCache.get(glyphId)!
    const paintOffset = baseGlyphPaintsV1.get(glyphId)
    if (paintOffset === undefined) {
      paintTreeCache.set(glyphId, null)
      return null
    }
    const tree = parsePaint(reader, baseGlyphListOffset + paintOffset, layerPaints, new Set())
    paintTreeCache.set(glyphId, tree)
    return tree
  }

  return {
    version,

    getColorLayers(glyphId: number): ColorLayer[] | null {
      const base = baseGlyphsV0.get(glyphId)
      if (!base) return null
      const result: ColorLayer[] = []
      for (let i = 0; i < base.numLayers; i++) {
        const layer = layersV0[base.firstLayerIndex + i]
        if (layer) {
          result.push({ glyphId: layer.glyphId, paletteIndex: layer.paletteIndex })
        }
      }
      return result
    },

    getPaintTree(glyphId: number, coords?: number[] | null): PaintNode | null {
      if (!coords || coords.length === 0 || !itemVariationStore) {
        return getBasePaintTree(glyphId)
      }
      if (variedCacheCoords !== coords) {
        variedPaintTreeCache.clear()
        variedCacheCoords = coords
      }
      if (variedPaintTreeCache.has(glyphId)) return variedPaintTreeCache.get(glyphId)!
      const base = getBasePaintTree(glyphId)
      const varied = base
        ? applyPaintVariation({ ivs: itemVariationStore, varIndexMap, coords }, base)
        : null
      variedPaintTreeCache.set(glyphId, varied)
      return varied
    },

    getClipBox(glyphId: number, coords?: number[] | null): ClipBox | null {
      if (!clipBoxes) return null
      const box = clipBoxes.get(glyphId) ?? null
      if (!box) return null
      if (!coords || coords.length === 0 || !itemVariationStore) return box
      return applyClipBoxVariation({ ivs: itemVariationStore, varIndexMap, coords }, box)
    },
  }
}
