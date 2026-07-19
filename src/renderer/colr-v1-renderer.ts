/**
 * COLR v1 paint tree renderer
 *
 * Recursively traverses the PaintNode tree and issues drawing commands
 * to the Canvas/PDF backends through the ColrV1PaintOps interface.
 */
import type { Font } from '../font.js'
import type {
  PaintNode, ColorLine, ColorStop, ClipBox,
  CompositeMode, ExtendMode,
} from '../parsers/tables/colr.js'

// --- Color resolution ---

export interface ResolvedColor {
  r: number  // 0-1
  g: number  // 0-1
  b: number  // 0-1
  a: number  // 0-1
}

export interface ResolvedColorStop {
  offset: number
  color: ResolvedColor
}

export function resolveColor(
  font: Font,
  paletteIndex: number,
  alpha: number,
  foregroundColor: ResolvedColor,
): ResolvedColor {
  if (paletteIndex === 0xFFFF) {
    return { r: foregroundColor.r, g: foregroundColor.g, b: foregroundColor.b, a: foregroundColor.a * alpha }
  }
  const c = font.getColorFromSelectedPalette(paletteIndex)
  if (!c) throw new Error(`COLR palette entry ${paletteIndex} requires a CPAL color`)
  return {
    r: c.r / 255,
    g: c.g / 255,
    b: c.b / 255,
    a: (c.a / 255) * alpha,
  }
}

export function resolveColorLine(
  font: Font,
  colorLine: ColorLine,
  foregroundColor: ResolvedColor,
): { extend: ExtendMode, stops: ResolvedColorStop[] } {
  const stops: ResolvedColorStop[] = []
  for (let i = 0; i < colorLine.stops.length; i++) {
    const s = colorLine.stops[i]!
    stops.push({
      offset: s.stopOffset,
      color: resolveColor(font, s.paletteIndex, s.alpha, foregroundColor),
    })
  }
  return { extend: colorLine.extend, stops }
}

/** Sample a ColorStop array with linear interpolation */
export function sampleColorLine(stops: ResolvedColorStop[], t: number): ResolvedColor {
  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 0 }
  if (stops.length === 1) return stops[0]!.color

  if (t <= stops[0]!.offset) return stops[0]!.color
  if (t >= stops[stops.length - 1]!.offset) return stops[stops.length - 1]!.color

  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i]!
    const s1 = stops[i + 1]!
    if (t >= s0.offset && t <= s1.offset) {
      const frac = s1.offset === s0.offset ? 0 : (t - s0.offset) / (s1.offset - s0.offset)
      return {
        r: s0.color.r + (s1.color.r - s0.color.r) * frac,
        g: s0.color.g + (s1.color.g - s0.color.g) * frac,
        b: s0.color.b + (s1.color.b - s0.color.b) * frac,
        a: s0.color.a + (s1.color.a - s0.color.a) * frac,
      }
    }
  }
  return stops[stops.length - 1]!.color
}

/**
 * Extend gradient stops for REPEAT/REFLECT modes.
 * Returns extended stops in [0,1] for a gradient that covers (2*N+1) periods.
 */
export function extendGradientStops(
  stops: ResolvedColorStop[], extend: ExtendMode, N: number,
): ResolvedColorStop[] {
  if (extend === 0 || stops.length < 2) return stops

  const totalPeriods = 2 * N + 1
  const result: ResolvedColorStop[] = []

  for (let k = -N; k <= N; k++) {
    // REFLECT: odd-distance periods are reversed
    const isReflected = extend === 2 && (Math.abs(k) % 2 !== 0)
    for (let j = 0; j < stops.length; j++) {
      const s = stops[j]!
      let globalOffset: number
      if (isReflected) {
        globalOffset = (N + k + 1 - s.offset) / totalPeriods
      } else {
        globalOffset = (N + k + s.offset) / totalPeriods
      }
      result.push({ offset: globalOffset, color: s.color })
    }
  }

  result.sort((a, b) => a.offset - b.offset)
  return result
}

/**
 * Apply extend mode to a parameter value for sweep gradient sampling.
 * Maps arbitrary t to [sMin, sMax] according to the extend mode.
 */
export function mapExtendMode(
  t: number, sMin: number, sMax: number, extend: ExtendMode,
): number {
  if (extend === 0) {
    return t < sMin ? sMin : t > sMax ? sMax : t
  }
  const period = sMax - sMin
  if (period <= 0) return sMin

  if (extend === 1) { // REPEAT
    let mapped = (t - sMin) % period
    if (mapped < 0) mapped += period
    return sMin + mapped
  }

  // REFLECT
  let relative = (t - sMin) / period
  let intPart = Math.floor(relative)
  let fracPart = relative - intPart
  if (fracPart < 0) { fracPart += 1; intPart -= 1 }
  if ((intPart & 1) !== 0) fracPart = 1 - fracPart
  return sMin + fracPart * period
}

/** Convert RGBA to a CSS rgba() string */
export function colorToRgba(c: ResolvedColor): string {
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`
}

/** Parse a CSS color string into a ResolvedColor */
export function parseForegroundColor(color: string): ResolvedColor {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16) / 255,
        g: parseInt(hex[1]! + hex[1]!, 16) / 255,
        b: parseInt(hex[2]! + hex[2]!, 16) / 255,
        a: 1,
      }
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      }
    }
  }
  return { r: 0, g: 0, b: 0, a: 1 }
}

// --- Paint operations interface ---

export interface ColrV1PaintOps {
  save(): void
  restore(): void
  transform(xx: number, yx: number, xy: number, yy: number, dx: number, dy: number): void
  clipGlyph(font: Font, glyphId: number, scale: number, cx: number, baseY: number): void
  clipRect(xMin: number, yMin: number, xMax: number, yMax: number, scale: number, cx: number, baseY: number): void
  fillSolid(color: ResolvedColor): void
  fillLinearGradient(
    x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
    stops: ResolvedColorStop[], extend: ExtendMode,
    scale: number, cx: number, baseY: number,
  ): void
  fillRadialGradient(
    x0: number, y0: number, r0: number, x1: number, y1: number, r1: number,
    stops: ResolvedColorStop[], extend: ExtendMode,
    scale: number, cx: number, baseY: number,
  ): void
  fillSweepGradient(
    centerX: number, centerY: number,
    startAngle: number, endAngle: number,
    stops: ResolvedColorStop[], extend: ExtendMode,
    scale: number, cx: number, baseY: number,
  ): void
  setCompositeMode(mode: CompositeMode): void
  resetCompositeMode(): void
}

// --- Tree walker ---

const MAX_DEPTH = 64

export function renderColrV1Glyph(
  font: Font,
  glyphId: number,
  ops: ColrV1PaintOps,
  scale: number,
  cx: number,
  baseY: number,
  foregroundColor: ResolvedColor,
): void {
  const paintTree = font.getPaintTree(glyphId)
  if (!paintTree) return

  const clipBox = font.getClipBox(glyphId)
  if (clipBox) {
    ops.save()
    ops.clipRect(clipBox.xMin, clipBox.yMin, clipBox.xMax, clipBox.yMax, scale, cx, baseY)
  }

  renderPaintNode(font, paintTree, ops, scale, cx, baseY, foregroundColor, 0)

  if (clipBox) {
    ops.restore()
  }
}

function renderPaintNode(
  font: Font,
  node: PaintNode,
  ops: ColrV1PaintOps,
  scale: number,
  cx: number,
  baseY: number,
  fg: ResolvedColor,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return

  switch (node.type) {
    case 'ColrLayers':
      for (let li = 0; li < node.layers.length; li++) {
        renderPaintNode(font, node.layers[li]!, ops, scale, cx, baseY, fg, depth + 1)
      }
      break

    case 'Solid':
      ops.fillSolid(resolveColor(font, node.paletteIndex, node.alpha, fg))
      break

    case 'LinearGradient': {
      const { extend, stops } = resolveColorLine(font, node.colorLine, fg)
      ops.fillLinearGradient(node.x0, node.y0, node.x1, node.y1, node.x2, node.y2, stops, extend, scale, cx, baseY)
      break
    }

    case 'RadialGradient': {
      const { extend, stops } = resolveColorLine(font, node.colorLine, fg)
      ops.fillRadialGradient(node.x0, node.y0, node.r0, node.x1, node.y1, node.r1, stops, extend, scale, cx, baseY)
      break
    }

    case 'SweepGradient': {
      const { extend, stops } = resolveColorLine(font, node.colorLine, fg)
      ops.fillSweepGradient(node.centerX, node.centerY, node.startAngle, node.endAngle, stops, extend, scale, cx, baseY)
      break
    }

    case 'Glyph':
      ops.save()
      ops.clipGlyph(font, node.glyphId, scale, cx, baseY)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break

    case 'ColrGlyph': {
      const subTree = font.getPaintTree(node.glyphId)
      if (subTree) {
        const subClip = font.getClipBox(node.glyphId)
        if (subClip) {
          ops.save()
          ops.clipRect(subClip.xMin, subClip.yMin, subClip.xMax, subClip.yMax, scale, cx, baseY)
        }
        renderPaintNode(font, subTree, ops, scale, cx, baseY, fg, depth + 1)
        if (subClip) {
          ops.restore()
        }
      }
      break
    }

    case 'Transform': {
      const t = node.transform
      ops.save()
      // Conversion from font coordinates (Y-up) to screen coordinates (Y-down):
      // yx and xy need their signs flipped (off-diagonal components)
      ops.transform(t.xx, -t.yx, -t.xy, t.yy, t.dx * scale, -t.dy * scale)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break
    }

    case 'Translate':
      ops.save()
      ops.transform(1, 0, 0, 1, node.dx * scale, -node.dy * scale)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break

    case 'Scale':
      ops.save()
      ops.transform(node.scaleX, 0, 0, node.scaleY, 0, 0)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break

    case 'ScaleAroundCenter': {
      const cdx = node.centerX * scale
      const cdy = -node.centerY * scale
      ops.save()
      ops.transform(1, 0, 0, 1, cdx, cdy)
      ops.transform(node.scaleX, 0, 0, node.scaleY, 0, 0)
      ops.transform(1, 0, 0, 1, -cdx, -cdy)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break
    }

    case 'ScaleUniform':
      ops.save()
      ops.transform(node.scale, 0, 0, node.scale, 0, 0)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break

    case 'ScaleUniformAroundCenter': {
      const cdx = node.centerX * scale
      const cdy = -node.centerY * scale
      ops.save()
      ops.transform(1, 0, 0, 1, cdx, cdy)
      ops.transform(node.scale, 0, 0, node.scale, 0, 0)
      ops.transform(1, 0, 0, 1, -cdx, -cdy)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break
    }

    case 'Rotate': {
      const rad = -node.angle * 2 * Math.PI
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      ops.save()
      ops.transform(cos, sin, -sin, cos, 0, 0)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break
    }

    case 'RotateAroundCenter': {
      const cdx = node.centerX * scale
      const cdy = -node.centerY * scale
      const rad = -node.angle * 2 * Math.PI
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      ops.save()
      ops.transform(1, 0, 0, 1, cdx, cdy)
      ops.transform(cos, sin, -sin, cos, 0, 0)
      ops.transform(1, 0, 0, 1, -cdx, -cdy)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break
    }

    case 'Skew': {
      const tanX = Math.tan(node.xSkewAngle * 2 * Math.PI)
      const tanY = Math.tan(-node.ySkewAngle * 2 * Math.PI)
      ops.save()
      ops.transform(1, tanY, -tanX, 1, 0, 0)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break
    }

    case 'SkewAroundCenter': {
      const cdx = node.centerX * scale
      const cdy = -node.centerY * scale
      const tanX = Math.tan(node.xSkewAngle * 2 * Math.PI)
      const tanY = Math.tan(-node.ySkewAngle * 2 * Math.PI)
      ops.save()
      ops.transform(1, 0, 0, 1, cdx, cdy)
      ops.transform(1, tanY, -tanX, 1, 0, 0)
      ops.transform(1, 0, 0, 1, -cdx, -cdy)
      renderPaintNode(font, node.paint, ops, scale, cx, baseY, fg, depth + 1)
      ops.restore()
      break
    }

    case 'Composite':
      renderPaintNode(font, node.backdrop, ops, scale, cx, baseY, fg, depth + 1)
      ops.save()
      ops.setCompositeMode(node.compositeMode)
      renderPaintNode(font, node.source, ops, scale, cx, baseY, fg, depth + 1)
      ops.resetCompositeMode()
      ops.restore()
      break
  }
}
