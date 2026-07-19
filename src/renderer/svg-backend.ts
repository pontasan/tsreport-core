/**
 * SVG backend
 *
 * Serializes RenderBackend drawing primitives into one standalone <svg>
 * document string per page. Drawing semantics are a faithful port of the
 * Canvas backend so that the SVG output shows exactly the same layout result
 * and the same glyph shapes as the PDF output: glyph outlines are emitted as
 * <path> fills, including vertical writing, synthetic bold/italic,
 * underline/strikethrough, COLR v0 layers and the COLR v1 paint tree.
 *
 * Coordinates are kept in pt and used directly as viewBox user units.
 */

import type { Font } from '../font.js'
import { shapeGlyphRun } from '../measure/glyph-run.js'
import type {
  RenderBackend, TextDrawOptions, ShapeDrawOptions, RectDrawOptions, ResolvedRectCornerRadii,
  PathPaintOptions, PaintValue, GradientPaint, GradientStop, BlendMode, ImageDrawOptions,
  MeshGradientPaint, TilingPatternPaint, FunctionShadingPaint, TileGraphic, TileGroupGraphic,
  LinkAnnotation, BookmarkEntry, AnchorEntry, StructureTag, TransparencyGroupOptions,
} from './backend.js'
import type { PdfSpecialColorDef } from '../types/template.js'
import { resolveRectCornerRadii } from './backend.js'
import type { RenderFormField } from './backend.js'
import { paintFormFieldAppearance } from './form-field-appearance.js'
import type { CompositeMode, ExtendMode } from '../parsers/tables/colr.js'
import { detectImageFormat } from '../image/image-utils.js'
import { resolveImageResource, type RasterImageFormat } from './image-resource.js'
import { parseOpenTypeSvg, parseSvg } from '../svg/svg-parser.js'
import { buildSvgPathD } from '../svg/svg-path-builder.js'
import { renderSvg, renderSvgGlyph } from '../svg/svg-renderer.js'
import { isComplexPaint, pathCoordsBounds, pathStrokeBounds, tessellateFunctionShading, tessellateMeshGradient, tileIndexRange } from './complex-paint.js'
import { toDisplayColor } from './color.js'
import type { SvgDocument } from '../svg/svg-types.js'
import type { OverprintMode, RenderingIntent, RenderCalculatorFunction, RenderTransferFunction } from '../types/render.js'
import { BackendImageResources } from '../image-resource-map.js'
import { evaluateCalculatorSource, evaluateTransferFunctionDef } from '../pdf/pdf-function.js'
import { prepareBitmapGlyph } from './bitmap-glyph.js'
import { mergePositionedGlyphOutlines, type PositionedGlyphOutline } from './merged-glyph-outline.js'
import {
  renderColrV1Glyph, parseForegroundColor, sampleColorLine, mapExtendMode,
  type ColrV1PaintOps, type ResolvedColor, type ResolvedColorStop,
} from './colr-v1-renderer.js'

// Empty outline for a bitmap-only glyph (drawn from its embedded bitmap instead).
const EMPTY_GLYPH_COMMANDS = new Uint8Array(0)
const EMPTY_GLYPH_COORDS = new Float32Array(0)

export interface SvgBackendOptions {
  /** fontId → Font mapping (when specified, glyph outlines are drawn as paths) */
  fonts?: Record<string, Font>
  /** Image resources (imageId → base64/data URI string or binary) */
  images?: Record<string, string | Uint8Array>
  /** Page background color (null for no background fill, default: '#FFFFFF') */
  background?: string | null
}

/** Per-page output buffers shared between the backend and the COLR v1 ops */
interface SvgPageSink {
  /** <defs> content (clip paths, gradients) */
  defs: string[]
  /** Page body markup chunks */
  body: string[]
  /** Id allocator for defs entries */
  idCounter: number
}

/**
 * One graphics-state frame (save/restore).
 * Groups opened while the frame was active are closed on restore, and the
 * scalar state (opacity / blend mode) is reverted to its value at save time.
 */
interface SvgStateFrame {
  groupsOpened: number
  savedAlpha: number
  savedBlendMode: BlendMode
  savedAlphaIsShape: boolean
  savedTextKnockout: boolean
}

/**
 * A transparency-group or soft-mask capture (A6.2/A6.3). Body markup pushed
 * after `mark` is spliced out on end and wrapped (as `<g opacity mask>`) or
 * moved into a `<mask>` def.
 */
interface SvgCaptureFrame {
  kind: 'group' | 'mask'
  mark: number
  stateFrameDepth: number
  groupsOpenedAtCapture: number
  savedAlpha: number
  savedBlendMode: BlendMode
  savedAlphaIsShape: boolean
  savedTextKnockout: boolean
  /** group: group constant alpha. */
  opacity?: number
  /** group: whether blending is isolated from the backdrop. */
  isolated?: boolean
  /** group: referenced soft-mask id, or null. */
  maskId?: string | null
  /** mask: 'luminosity' | 'alpha'. */
  maskType?: 'luminosity' | 'alpha'
  /** mask: group bounds (pt) for the backdrop rect. */
  width?: number
  height?: number
  x?: number
  y?: number
  /** mask: /BC backdrop color (DeviceRGB 0-1). */
  backdrop?: [number, number, number]
  /** mask: /SMask /TR transfer function. */
  maskTransfer?: 'Identity' | RenderTransferFunction
}

/** Collected per-glyph drawing info (port of the Canvas backend glyph loop) */
interface SvgGlyphInfo {
  gid: number
  advanceWidth: number
  /** Pen advance for this glyph (horizontal or vertical, pt) */
  advance: number
  /** GPOS placement offsets (pt) */
  xOffset: number
  yOffset: number
  commands: Uint8Array
  coords: Float32Array
  xScale: number
  yScale: number
  rotation: 0 | 90
}

/**
 * SVG backend
 *
 * Produces one complete <svg> string per page; call getPages() after
 * endDocument() (or after the last endPage() when driving pages manually).
 */
export class SvgBackend implements RenderBackend {
  private fonts: Record<string, Font> | undefined
  private readonly imageResources: BackendImageResources
  private background: string | null
  private pages: string[] = []
  private sink: SvgPageSink = { defs: [], body: [], idCounter: 0 }
  private frames: SvgStateFrame[] = []
  private frameDepth = 0
  private pageWidth = 0
  private pageHeight = 0
  /**
   * Current alpha, the exact equivalent of Canvas globalAlpha / the PDF
   * ExtGState fill+stroke alpha: setOpacity() replaces it absolutely and it is
   * applied per drawing operation. A nested <g opacity> could not reproduce
   * that state semantics (nesting multiplies and cannot raise opacity again),
   * so the value is emitted as fill-opacity/stroke-opacity/opacity attributes
   * on each element instead.
   */
  private alpha = 1
  /** Current blend mode, applied per element as mix-blend-mode (Canvas globalCompositeOperation semantics) */
  private blendMode: BlendMode = 'normal'
  private alphaIsShape = false
  private textKnockout = true
  /** Transparency group / soft mask capture stack (A6.2/A6.3). */
  private captureStack: SvgCaptureFrame[] = []
  /** A finalized soft-mask id awaiting the next beginTransparencyGroup. */
  private pendingMaskId: string | null = null
  /** imageId → data URI cache (avoids re-encoding repeated images) */
  private imageDataUris = new Map<string, string>()
  /** OT-SVG glyph documents parsed once per document string */
  private svgGlyphDocCache = new Map<string, SvgDocument>()

  constructor(options?: SvgBackendOptions) {
    this.fonts = options?.fonts
    this.imageResources = new BackendImageResources(options?.images)
    this.background = options?.background !== undefined ? options.background : '#FFFFFF'
  }

  /** Complete <svg> document per page (available after the pages were ended) */
  getPages(): string[] {
    return this.pages
  }

  beginDocument(): void {
    this.imageResources.beginDocument()
    this.imageDataUris.clear()
    this.pages = []
  }

  endDocument(): void {
    // Pages are finalized in endPage(); nothing document-level to emit
  }

  beginPage(width: number, height: number): void {
    this.imageResources.beginPage()
    this.pageWidth = width
    this.pageHeight = height
    this.sink = { defs: [], body: [], idCounter: 0 }
    this.frameDepth = 0
    this.alpha = 1
    this.blendMode = 'normal'
    this.alphaIsShape = false
    this.textKnockout = true
    if (this.background !== null) {
      this.sink.body.push(
        `<rect x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="${escapeXmlAttr(this.background)}"/>`,
      )
    }
  }

  endPage(): void {
    const sink = this.sink
    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${fmt(this.pageWidth)}pt" height="${fmt(this.pageHeight)}pt" viewBox="0 0 ${fmt(this.pageWidth)} ${fmt(this.pageHeight)}">`,
    ]
    if (sink.defs.length > 0) {
      parts.push('<defs>')
      for (let i = 0; i < sink.defs.length; i++) parts.push(sink.defs[i]!)
      parts.push('</defs>')
    }
    for (let i = 0; i < sink.body.length; i++) parts.push(sink.body[i]!)
    parts.push('</svg>')
    this.pages.push(parts.join(''))
  }

  // ─── Graphics state ───

  save(): void {
    let frame = this.frames[this.frameDepth]
    if (frame === undefined) {
      frame = {
        groupsOpened: 0, savedAlpha: this.alpha, savedBlendMode: this.blendMode,
        savedAlphaIsShape: this.alphaIsShape, savedTextKnockout: this.textKnockout,
      }
      this.frames.push(frame)
    } else {
      frame.groupsOpened = 0
      frame.savedAlpha = this.alpha
      frame.savedBlendMode = this.blendMode
      frame.savedAlphaIsShape = this.alphaIsShape
      frame.savedTextKnockout = this.textKnockout
    }
    this.frameDepth++
  }

  restore(): void {
    const frame = this.frames[--this.frameDepth]!
    const body = this.sink.body
    for (let i = 0; i < frame.groupsOpened; i++) body.push('</g>')
    this.alpha = frame.savedAlpha
    this.blendMode = frame.savedBlendMode
    this.alphaIsShape = frame.savedAlphaIsShape
    this.textKnockout = frame.savedTextKnockout
  }

  translate(x: number, y: number): void {
    if (x === 0 && y === 0) return
    this.openGroup(`transform="translate(${fmt(x)} ${fmt(y)})"`)
  }

  rotate(angle: number): void {
    if (angle === 0) return
    this.openGroup(`transform="rotate(${fmt(angle)})"`)
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.openGroup(`transform="matrix(${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)} ${fmt(e)} ${fmt(f)})"`)
  }

  clip(x: number, y: number, width: number, height: number): void {
    const sink = this.sink
    const id = `c${sink.idCounter++}`
    sink.defs.push(
      `<clipPath id="${id}"><rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}"/></clipPath>`,
    )
    this.openGroup(`clip-path="url(#${id})"`)
  }

  clipPath(commands: Uint8Array, coords: Float32Array, fillRule?: 'nonzero' | 'evenodd'): void {
    const sink = this.sink
    const id = `c${sink.idCounter++}`
    const rule = fillRule === 'evenodd' ? ' clip-rule="evenodd"' : ''
    sink.defs.push(`<clipPath id="${id}"><path d="${buildSvgPathD(commands, coords)}"${rule}/></clipPath>`)
    this.openGroup(`clip-path="url(#${id})"`)
  }

  setOpacity(opacity: number): void {
    // Absolute replacement, applied per element (see the alpha field comment)
    this.alpha = opacity
  }

  setBlendMode(mode: BlendMode): void {
    // Absolute replacement, applied per element as mix-blend-mode
    this.blendMode = mode
  }

  setOverprint(fill: boolean, stroke: boolean, mode: OverprintMode): void {
    this.blendMode = mode === 1 && (fill || stroke) ? 'multiply' : 'normal'
  }

  setRenderingIntent(_intent: RenderingIntent): void {
    // Standalone SVG uses the document's sRGB output space; without an output
    // profile all four PDF rendering intents have the same color conversion.
  }

  setTransparencyParameters(alphaIsShape: boolean | undefined, textKnockout: boolean | undefined): void {
    if (alphaIsShape !== undefined) this.alphaIsShape = alphaIsShape
    if (textKnockout !== undefined) this.textKnockout = textKnockout
  }

  // ─── Transparency groups + soft masks (A6.2/A6.3) ───
  // Body markup produced between begin/end is captured. A soft mask becomes a
  // <mask> def (luminance by default, mask-type:alpha for alpha masks); a
  // transparency group becomes an isolated <g opacity mask> wrapper, so the
  // group composites as a unit. Mask content is authored in the current
  // transformed user space, which is exactly the referencing group's user
  // space (maskContentUnits="userSpaceOnUse"), so no re-transform is needed.

  beginSoftMask(type: 'luminosity' | 'alpha', width: number, height: number, backdrop?: [number, number, number], transferFunction?: 'Identity' | RenderTransferFunction, x = 0, y = 0): void {
    const stateFrame = this.frames[this.frameDepth - 1]
    this.captureStack.push({
      kind: 'mask', mark: this.sink.body.length,
      stateFrameDepth: this.frameDepth,
      groupsOpenedAtCapture: stateFrame?.groupsOpened ?? 0,
      savedAlpha: this.alpha, savedBlendMode: this.blendMode,
      savedAlphaIsShape: this.alphaIsShape, savedTextKnockout: this.textKnockout,
      maskType: type, width, height, x, y, backdrop, maskTransfer: transferFunction,
    })
    this.alpha = 1
    this.blendMode = 'normal'
    this.alphaIsShape = false
    this.textKnockout = true
  }

  endSoftMask(): void {
    const frame = this.captureStack.pop()
    if (frame === undefined || frame.kind !== 'mask') throw new Error('endSoftMask without a matching beginSoftMask')
    const captured = this.sink.body.splice(frame.mark)
    this.closeGroupsOpenedDuringCapture(frame, captured)
    this.alpha = frame.savedAlpha
    this.blendMode = frame.savedBlendMode
    this.alphaIsShape = frame.savedAlphaIsShape
    this.textKnockout = frame.savedTextKnockout
    const id = `m${this.sink.idCounter++}`
    // A /SMask /TR transfer function is applied by filtering the mask content:
    // convert its luminance to alpha, remap that alpha through the sampled
    // function (feComponentTransfer table), and use the result as the mask
    // (mask-type:alpha). For an alpha mask the luminanceToAlpha step is skipped.
    let filterAttr = ''
    let maskTypeAttr = frame.maskType === 'alpha' ? ' style="mask-type:alpha"' : ''
    if (frame.maskTransfer && frame.maskTransfer !== 'Identity') {
      const filterId = `f${this.sink.idCounter++}`
      const table = buildSvgTransferTable(frame.maskTransfer)
      const lumStep = frame.maskType === 'alpha' ? '' : '<feColorMatrix type="luminanceToAlpha"/>'
      this.sink.defs.push(
        `<filter id="${filterId}" x="0%" y="0%" width="100%" height="100%">${lumStep}` +
        `<feComponentTransfer><feFuncA type="table" tableValues="${table}"/></feComponentTransfer></filter>`,
      )
      filterAttr = ` filter="url(#${filterId})"`
      maskTypeAttr = ' style="mask-type:alpha"'
    }
    const parts: string[] = [
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="${fmt(frame.x!)}" y="${fmt(frame.y!)}" width="${fmt(frame.width!)}" height="${fmt(frame.height!)}"${maskTypeAttr}>`,
    ]
    if (filterAttr) parts.push(`<g${filterAttr}>`)
    // Luminosity backdrop (PDF /SMask /BC): fill the mask region before content.
    if (frame.maskType !== 'alpha' && frame.backdrop) {
      parts.push(
        `<rect x="${fmt(frame.x!)}" y="${fmt(frame.y!)}" width="${fmt(frame.width!)}" height="${fmt(frame.height!)}" fill="${rgb01ToHex(frame.backdrop)}"/>`,
      )
    }
    for (let i = 0; i < captured.length; i++) parts.push(captured[i]!)
    if (filterAttr) parts.push('</g>')
    parts.push('</mask>')
    this.sink.defs.push(parts.join(''))
    this.pendingMaskId = id
  }

  beginTransparencyGroup(_width: number, _height: number, options: TransparencyGroupOptions): void {
    const stateFrame = this.frames[this.frameDepth - 1]
    this.captureStack.push({
      kind: 'group', mark: this.sink.body.length,
      stateFrameDepth: this.frameDepth,
      groupsOpenedAtCapture: stateFrame?.groupsOpened ?? 0,
      savedAlpha: this.alpha, savedBlendMode: this.blendMode,
      savedAlphaIsShape: this.alphaIsShape, savedTextKnockout: this.textKnockout,
      isolated: options.isolated,
      opacity: options.opacity,
      maskId: options.hasSoftMask ? this.pendingMaskId : null,
    })
    this.pendingMaskId = null
    // Children draw at full alpha/normal blend; the group's alpha and blend
    // apply to the wrapper so overlapping children composite as one unit.
    this.alpha = 1
    this.blendMode = 'normal'
    this.alphaIsShape = false
    this.textKnockout = true
  }

  endTransparencyGroup(): void {
    const frame = this.captureStack.pop()
    if (frame === undefined || frame.kind !== 'group') throw new Error('endTransparencyGroup without a matching beginTransparencyGroup')
    const captured = this.sink.body.splice(frame.mark)
    this.closeGroupsOpenedDuringCapture(frame, captured)
    this.alpha = frame.savedAlpha
    this.blendMode = frame.savedBlendMode
    this.alphaIsShape = frame.savedAlphaIsShape
    this.textKnockout = frame.savedTextKnockout
    let attrs = ''
    if (frame.opacity != null && frame.opacity < 1) attrs += ` opacity="${fmt(frame.opacity)}"`
    if (frame.maskId) attrs += ` mask="url(#${frame.maskId})"`
    const blend = frame.savedBlendMode !== 'normal' ? `mix-blend-mode:${frame.savedBlendMode};` : ''
    attrs += ` style="${blend}isolation:${frame.isolated ? 'isolate' : 'auto'}"`
    const parts: string[] = [`<g${attrs}>`]
    for (let i = 0; i < captured.length; i++) parts.push(captured[i]!)
    parts.push('</g>')
    this.sink.body.push(parts.join(''))
  }

  private closeGroupsOpenedDuringCapture(frame: SvgCaptureFrame, captured: string[]): void {
    if (this.frameDepth !== frame.stateFrameDepth) {
      throw new Error('SVG capture ended at a different graphics-state depth')
    }
    const stateFrame = this.frames[this.frameDepth - 1]
    if (stateFrame === undefined) return
    const opened = stateFrame.groupsOpened - frame.groupsOpenedAtCapture
    if (opened < 0) throw new Error('SVG capture graphics-state groups are unbalanced')
    for (let i = 0; i < opened; i++) captured.push('</g>')
    stateFrame.groupsOpened = frame.groupsOpenedAtCapture
  }

  private openGroup(attrs: string): void {
    this.sink.body.push(`<g ${attrs}>`)
    this.frames[this.frameDepth - 1]!.groupsOpened++
  }

  private blendStyleAttr(): string {
    if (this.blendMode === 'normal') return ''
    return ` style="mix-blend-mode:${this.blendMode}"`
  }

  // ─── Drawing primitives ───

  drawText(
    x: number, y: number,
    text: string,
    fontId: string, fontSize: number, color: string,
    options?: TextDrawOptions,
  ): void {
    color = toDisplayColor(color)
    const font = this.fonts?.[fontId]
    if (font) {
      this.drawTextWithFont(x, y, text, font, fontSize, color, options)
    } else {
      this.drawTextWithCSS(x, y, text, fontId, fontSize, color, options)
    }
  }

  drawLine(
    x1: number, y1: number, x2: number, y2: number,
    lineWidth: number, color: string,
    dash?: number[],
  ): void {
    color = toDisplayColor(color)
    let attrs = ` stroke="${escapeXmlAttr(color)}" stroke-width="${fmt(lineWidth)}"`
    if (dash && dash.length > 0) attrs += ` stroke-dasharray="${joinNumbers(dash)}"`
    if (this.alpha < 1) attrs += ` stroke-opacity="${fmt(this.alpha)}"`
    attrs += this.blendStyleAttr()
    this.sink.body.push(
      `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"${attrs}/>`,
    )
  }

  drawFormField(x: number, y: number, width: number, height: number, field: RenderFormField): void {
    paintFormFieldAppearance(this, x, y, width, height, field, field.fieldType === 'checkbox' || field.fieldType === 'radio' ? field.checked === true : true)
  }

  drawRect(
    x: number, y: number, width: number, height: number,
    options?: RectDrawOptions,
  ): void {
    if (!options?.fill && !options?.stroke) return
    const radii = resolveRectCornerRadii(width, height, options)
    const hasRoundedCorners = radii.topLeft > 0
      || radii.topRight > 0
      || radii.bottomRight > 0
      || radii.bottomLeft > 0
    const attrs = this.paintAttrs(options, options.fill, options.stroke)
    if (hasRoundedCorners) {
      this.sink.body.push(`<path d="${roundedRectPathD(x, y, width, height, radii)}"${attrs}/>`)
    } else {
      this.sink.body.push(
        `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}"${attrs}/>`,
      )
    }
  }

  drawEllipse(
    cx: number, cy: number, rx: number, ry: number,
    options?: ShapeDrawOptions,
  ): void {
    if (!options?.fill && !options?.stroke) return
    const attrs = this.paintAttrs(options, options.fill, options.stroke)
    this.sink.body.push(
      `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}"${attrs}/>`,
    )
  }

  drawPath(
    commands: Uint8Array, coords: Float32Array,
    options?: ShapeDrawOptions,
  ): void {
    if (!options?.fill && !options?.stroke) return
    const attrs = this.paintAttrs(options, options.fill, options.stroke)
    this.sink.body.push(`<path d="${buildSvgPathD(commands, coords)}"${attrs}/>`)
  }

  drawPathData(
    d: string,
    transform: [number, number, number, number, number, number],
    options?: ShapeDrawOptions,
  ): boolean {
    if (!d || (!options?.fill && !options?.stroke)) return false
    const attrs = this.paintAttrs(options, options.fill, options.stroke)
    this.sink.body.push(
      `<path d="${escapeXmlAttr(d)}" transform="matrix(${fmt(transform[0])} ${fmt(transform[1])} ${fmt(transform[2])} ${fmt(transform[3])} ${fmt(transform[4])} ${fmt(transform[5])})"${attrs}/>`,
    )
    return true
  }

  drawPathWithPaints(
    commands: Uint8Array, coords: Float32Array,
    options: PathPaintOptions,
  ): void {
    if (isComplexPaint(options.stroke)) {
      this.emitComplexStrokePath(commands, coords, options.stroke, options)
      if (options.fill !== undefined) this.drawPathWithPaints(commands, coords, { ...options, stroke: undefined })
      return
    }
    const fillValue = options.fill
    if (fillValue !== undefined && typeof fillValue !== 'string' && (fillValue.type === 'mesh-gradient' || fillValue.type === 'tiling-pattern' || fillValue.type === 'function-shading')) {
      this.emitComplexFillPath(commands, coords, fillValue, options)
      if (options.stroke) {
        this.drawPathWithPaints(commands, coords, { ...options, fill: undefined })
      }
      return
    }
    const fill = fillValue ? this.resolvePaintValue(fillValue as string | GradientPaint) : undefined
    const stroke = options.stroke ? this.resolvePaintValue(options.stroke as string | GradientPaint) : undefined
    if (!fill && !stroke) return
    const attrs = this.paintAttrs(options, fill, stroke)
    this.sink.body.push(`<path d="${buildSvgPathD(commands, coords)}"${attrs}/>`)
  }

  /** Complex fill: clip to the path, then emit the shared deterministic content */
  private emitComplexFillPath(
    commands: Uint8Array, coords: Float32Array,
    paint: MeshGradientPaint | TilingPatternPaint | FunctionShadingPaint,
    options: PathPaintOptions,
  ): void {
    const sink = this.sink
    const clipId = `g${sink.idCounter++}`
    const clipRule = options.fillRule === 'evenodd' ? ' clip-rule="evenodd"' : ''
    sink.defs.push(`<clipPath id="${clipId}"><path d="${buildSvgPathD(commands, coords)}"${clipRule}/></clipPath>`)
    let groupAttrs = ` clip-path="url(#${clipId})"`
    const opacity = clamp01(options.fillOpacity ?? 1) * this.alpha
    if (opacity < 1) groupAttrs += ` opacity="${fmt(opacity)}"`
    groupAttrs += this.blendStyleAttr()
    sink.body.push(`<g${groupAttrs}>`)
    this.emitComplexPaintContent(paint, coords)
    sink.body.push('</g>')
  }

  private emitComplexPaintContent(
    paint: MeshGradientPaint | TilingPatternPaint | FunctionShadingPaint,
    coords: Float32Array,
    bounds = pathCoordsBounds(coords),
  ): void {
    const sink = this.sink
    if (paint.type === 'mesh-gradient' || paint.type === 'function-shading') {
      const triangles = paint.type === 'mesh-gradient' ? tessellateMeshGradient(paint) : tessellateFunctionShading(paint)
      for (let i = 0; i < triangles.length; i++) {
        const t = triangles[i]!
        sink.body.push(
          `<path d="M${fmt(t.points[0])} ${fmt(t.points[1])}L${fmt(t.points[2])} ${fmt(t.points[3])}L${fmt(t.points[4])} ${fmt(t.points[5])}Z" fill="${t.color}"/>`,
        )
      }
    } else {
      this.emitTilingFill(paint, bounds)
    }
  }

  private emitComplexStrokePath(
    commands: Uint8Array,
    coords: Float32Array,
    paint: MeshGradientPaint | TilingPatternPaint | FunctionShadingPaint,
    options: PathPaintOptions,
  ): void {
    const sink = this.sink
    const maskId = `g${sink.idCounter++}`
    let attrs = ` fill="none" stroke="white" stroke-width="${fmt(options.strokeWidth ?? 1)}"`
    if (options.strokeLinecap !== undefined) attrs += ` stroke-linecap="${options.strokeLinecap}"`
    if (options.strokeLinejoin !== undefined) attrs += ` stroke-linejoin="${options.strokeLinejoin}"`
    if (options.strokeMiterLimit !== undefined) attrs += ` stroke-miterlimit="${fmt(options.strokeMiterLimit)}"`
    if (options.strokeDasharray !== undefined) attrs += ` stroke-dasharray="${options.strokeDasharray.map(fmt).join(' ')}"`
    if (options.strokeDashoffset !== undefined) attrs += ` stroke-dashoffset="${fmt(options.strokeDashoffset)}"`
    sink.defs.push(`<mask id="${maskId}" maskUnits="userSpaceOnUse"><path d="${buildSvgPathD(commands, coords)}"${attrs}/></mask>`)
    let groupAttrs = ` mask="url(#${maskId})"`
    const opacity = clamp01(options.strokeOpacity ?? 1) * this.alpha
    if (opacity < 1) groupAttrs += ` opacity="${fmt(opacity)}"`
    groupAttrs += this.blendStyleAttr()
    sink.body.push(`<g${groupAttrs}>`)
    this.emitComplexPaintContent(paint, coords, pathStrokeBounds(coords, options.strokeWidth ?? 1, options.strokeMiterLimit ?? 10))
    sink.body.push('</g>')
  }

  private emitTilingFill(paint: TilingPatternPaint, bounds: [number, number, number, number]): void {
    const sink = this.sink
    const range = tileIndexRange(paint, bounds)
    const cellCount = (range.i1 - range.i0 + 1) * (range.j1 - range.j0 + 1)
    if (cellCount > 65536) {
      throw new Error(`Tiling pattern produces ${cellCount} cells for one fill; the steps are degenerate`)
    }
    const m = paint.matrix
    sink.body.push(`<g transform="matrix(${fmt(m[0])} ${fmt(m[1])} ${fmt(m[2])} ${fmt(m[3])} ${fmt(m[4])} ${fmt(m[5])})">`)
    const [bx0, by0, bx1, by1] = paint.bbox
    // The cell clip is defined in tile-local space; clip-path applies inside
    // each tile group's own transform, so one definition serves every tile
    const cellClipId = `g${sink.idCounter++}`
    sink.defs.push(`<clipPath id="${cellClipId}"><rect x="${fmt(bx0)}" y="${fmt(by0)}" width="${fmt(bx1 - bx0)}" height="${fmt(by1 - by0)}"/></clipPath>`)
    for (let i = range.i0; i <= range.i1; i++) {
      for (let j = range.j0; j <= range.j1; j++) {
        sink.body.push(`<g transform="translate(${fmt(i * paint.xStep)} ${fmt(j * paint.yStep)})" clip-path="url(#${cellClipId})">`)
        this.emitTileGraphics(paint)
        sink.body.push('</g>')
      }
    }
    sink.body.push('</g>')
  }

  private emitTileGraphics(paint: TilingPatternPaint): void {
    for (let g = 0; g < paint.graphics.length; g++) this.emitTileGraphic(paint.graphics[g]!, paint)
  }

  private emitTileGraphic(graphic: TileGraphic, paint: TilingPatternPaint): void {
      if (graphic.kind === 'text') {
        this.drawText(graphic.x, graphic.y + graphic.fontSize, graphic.text, graphic.fontId, graphic.fontSize,
          paint.paintType === 'uncolored' ? requireUncoloredTilingColor(paint) : graphic.color)
        return
      }
      if (graphic.kind === 'image') {
        this.drawImage(graphic.x, graphic.y, graphic.width, graphic.height, graphic.imageId)
        return
      }
      if (graphic.kind === 'group') {
        this.emitTileGroup(graphic, paint)
        return
      }
      const stencil = paint.paintType === 'uncolored' ? requireUncoloredTilingColor(paint) : undefined
      this.drawPathWithPaints(graphic.commands, graphic.coords, {
        fill: graphic.fill === undefined ? undefined : stencil ?? graphic.fill,
        stroke: graphic.stroke === undefined ? undefined : stencil ?? graphic.stroke,
        strokeWidth: graphic.strokeWidth,
        fillRule: graphic.fillRule,
      })
  }

  private emitTileGroup(group: TileGroupGraphic, paint: TilingPatternPaint): void {
    if (group.optionalContent?.visible === false) return
    this.save()
    this.translate(group.x, group.y)
    if (group.affineTransform !== undefined) this.transform(...group.affineTransform)
    if (group.clipPath !== undefined) this.clipPath(group.clipPath.commands, group.clipPath.coords, group.clipPath.fillRule)
    if (group.blendMode !== undefined) this.setBlendMode(group.blendMode)
    if (group.alphaIsShape !== undefined || group.textKnockout !== undefined) {
      this.setTransparencyParameters(group.alphaIsShape, group.textKnockout)
    }
    const transparency = group.transparencyGroup === true || group.isolated === true || group.knockout === true || group.softMask !== undefined || (group.opacity !== undefined && group.opacity < 1)
    if (transparency) {
      if (group.softMask !== undefined) {
        this.beginSoftMask(group.softMask.type, group.width, group.height, group.softMask.backdrop, group.softMask.transferFunction)
        for (let i = 0; i < group.softMask.graphics.length; i++) this.emitTileGraphic(group.softMask.graphics[i]!, paint)
        this.endSoftMask()
      }
      this.beginTransparencyGroup(group.width, group.height, { isolated: group.isolated === true, knockout: group.knockout === true, opacity: group.opacity, hasSoftMask: group.softMask !== undefined })
    } else if (group.opacity !== undefined && group.opacity < 1) this.setOpacity(group.opacity)
    for (let i = 0; i < group.graphics.length; i++) this.emitTileGraphic(group.graphics[i]!, paint)
    if (transparency) this.endTransparencyGroup()
    this.restore()
  }

  drawSvg(x: number, y: number, width: number, height: number, svgData: string): void {
    // SVG content is re-rendered through this backend's own vector primitives
    const svgDoc = parseSvg(svgData)
    renderSvg(svgDoc, this, x, y, width, height)
  }

  drawImage(
    x: number, y: number, width: number, height: number,
    imageId: string,
    options?: ImageDrawOptions,
  ): void {
    const resolved = resolveImageResource(this.images, imageId)
    if (resolved.kind === 'missing' || resolved.kind === 'unsupported' || resolved.kind === 'pdf-passthrough') {
      this.drawImagePlaceholder(x, y, width, height)
      return
    }
    if (resolved.kind === 'external-url') {
      this.emitImageElement(x, y, width, height, escapeXmlAttr(resolved.url), options)
      return
    }
    if (resolved.kind === 'svg') {
      // SVG images are always drawn as vectors
      const svgDoc = parseSvg(resolved.data)
      renderSvg(svgDoc, this, x, y, width, height)
      return
    }
    let dataUri = this.imageDataUris.get(imageId)
    if (!dataUri) {
      dataUri = `data:${rasterMimeType(resolved.format)};base64,${bytesToBase64(resolved.data)}`
      this.imageDataUris.set(imageId, dataUri)
    }
    this.emitImageElement(x, y, width, height, dataUri, options)
  }

  drawImageData(
    x: number, y: number, width: number, height: number,
    data: Uint8Array,
    mimeType?: string,
  ): void {
    const format = detectImageFormat(data)
    const ext = mimeType && mimeType.includes('/') ? mimeType.split('/')[1]! : format
    const imageId = `__svg_data_${hashBytesFNV1a(data)}_${ext}`
    if (!this.images[imageId]) {
      this.images[imageId] = data
    }
    this.drawImage(x, y, width, height, imageId)
  }

  drawImageAffine(
    a: number, b: number, c: number, d: number, e: number, f: number,
    imageId: string,
    options?: ImageDrawOptions,
  ): void {
    // Image input coordinates are treated as y-down, so convert the SVG renderer's y-up matrix to a y-down matrix
    const t = imageAffineToYDown(a, b, c, d, e, f)
    this.sink.body.push(
      `<g transform="matrix(${fmt(t.a)} ${fmt(t.b)} ${fmt(t.c)} ${fmt(t.d)} ${fmt(t.e)} ${fmt(t.f)})">`,
    )
    this.drawImage(0, 0, 1, 1, imageId, options)
    this.sink.body.push('</g>')
  }

  drawImageDataAffine(
    a: number, b: number, c: number, d: number, e: number, f: number,
    data: Uint8Array,
    mimeType?: string,
  ): void {
    const format = detectImageFormat(data)
    const ext = mimeType && mimeType.includes('/') ? mimeType.split('/')[1]! : format
    const imageId = `__svg_data_${hashBytesFNV1a(data)}_${ext}`
    if (!this.images[imageId]) {
      this.images[imageId] = data
    }
    this.drawImageAffine(a, b, c, d, e, f, imageId)
  }

  setImages(images: Record<string, string | Uint8Array>): void {
    this.imageResources.setDocumentImages(images)
    this.imageDataUris.clear()
  }

  private get images(): Record<string, string | Uint8Array> {
    return this.imageResources.images
  }

  // ─── Annotations / bookmarks / Tagged content ───
  // SVG has no equivalent of PDF link annotations, outlines, named
  // destinations or structure tags, so these are intentionally no-ops.

  addAnnotation(_pageIndex: number, _annotation: LinkAnnotation): void {
    // No SVG equivalent for PDF link annotations
  }

  setBookmarks(_bookmarks: BookmarkEntry[]): void {
    // No SVG equivalent for the PDF outline
  }

  setAnchors(_anchors: AnchorEntry[]): void {
    // No SVG equivalent for PDF named destinations
  }

  setTagged(_lang?: string, _roleMap?: Record<string, string>): void {
    // No SVG equivalent for Tagged PDF mode
  }

  beginTaggedContent(_tag: StructureTag): void {
    // No SVG equivalent for tagged content (BDC/BMC)
  }

  endTaggedContent(): void {
    // No SVG equivalent for tagged content (EMC)
  }

  // ─── Shared paint attribute serialization ───

  private paintAttrs(
    options: ShapeDrawOptions | PathPaintOptions | undefined,
    fill: string | undefined,
    stroke: string | undefined,
  ): string {
    if (fill !== undefined) fill = toDisplayColor(fill)
    if (stroke !== undefined) stroke = toDisplayColor(stroke)
    let attrs: string
    if (fill) {
      attrs = ` fill="${escapeXmlAttr(fill)}"`
      if (options?.fillRule === 'evenodd') attrs += ' fill-rule="evenodd"'
      const fa = this.alpha * clamp01(options?.fillOpacity ?? 1)
      if (fa < 1) attrs += ` fill-opacity="${fmt(fa)}"`
    } else {
      attrs = ' fill="none"'
    }
    if (stroke) {
      attrs += ` stroke="${escapeXmlAttr(stroke)}" stroke-width="${fmt(options?.strokeWidth ?? 1)}"`
      const sa = this.alpha * clamp01(options?.strokeOpacity ?? 1)
      if (sa < 1) attrs += ` stroke-opacity="${fmt(sa)}"`
      const cap = options?.strokeLinecap ?? 'butt'
      if (cap !== 'butt') attrs += ` stroke-linecap="${cap}"`
      const join = options?.strokeLinejoin ?? 'miter'
      if (join !== 'miter') attrs += ` stroke-linejoin="${join}"`
      // Canvas defaults to miterLimit 10 while the SVG default is 4
      const miter = options?.strokeMiterLimit ?? 10
      if (miter !== 4) attrs += ` stroke-miterlimit="${fmt(miter)}"`
      const dash = options?.strokeDasharray
      if (dash && dash.length > 0) attrs += ` stroke-dasharray="${joinNumbers(dash)}"`
      if (options?.strokeDashoffset) attrs += ` stroke-dashoffset="${fmt(options.strokeDashoffset)}"`
    }
    attrs += this.blendStyleAttr()
    return attrs
  }

  private resolvePaintValue(paint: string | PdfSpecialColorDef | GradientPaint): string {
    if (typeof paint === 'string') return toDisplayColor(paint)
    if (paint.type === 'pdfSpecialColor') return paint.displayColor
    return this.registerGradientPaint(paint)
  }

  /** Register a gradient definition in <defs> and return its url() reference */
  private registerGradientPaint(paint: GradientPaint): string {
    const sink = this.sink
    const id = `g${sink.idCounter++}`
    const stops = normalizeGradientStops(paint.stops)
    let stopsMarkup = ''
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]!
      stopsMarkup += `<stop offset="${fmt(s.offset)}" stop-color="${escapeXmlAttr(s.color)}"`
      const o = clamp01(s.opacity ?? 1)
      if (o < 1) stopsMarkup += ` stop-opacity="${fmt(o)}"`
      stopsMarkup += '/>'
    }
    // repeat/reflect map to the native SVG spreadMethod (no manual stop extension needed)
    const spread = paint.spreadMethod ?? 'pad'
    const spreadAttr = spread !== 'pad' ? ` spreadMethod="${spread}"` : ''
    if (paint.type === 'linear-gradient') {
      sink.defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(paint.x1)}" y1="${fmt(paint.y1)}" x2="${fmt(paint.x2)}" y2="${fmt(paint.y2)}"${spreadAttr}>${stopsMarkup}</linearGradient>`,
      )
    } else {
      const fx = paint.fx ?? paint.cx
      const fy = paint.fy ?? paint.cy
      const fr = paint.fr ?? 0
      sink.defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(paint.cx)}" cy="${fmt(paint.cy)}" r="${fmt(paint.r)}" fx="${fmt(fx)}" fy="${fmt(fy)}" fr="${fmt(fr)}"${spreadAttr}>${stopsMarkup}</radialGradient>`,
      )
    }
    return `url(#${id})`
  }

  // ─── Images ───

  private emitImageElement(x: number, y: number, width: number, height: number, href: string, options?: ImageDrawOptions): void {
    // preserveAspectRatio="none": aspect handling is already computed by the layout engine
    let attrs = ` preserveAspectRatio="none" href="${href}"`
    if (this.alpha < 1) attrs += ` opacity="${fmt(this.alpha)}"`
    if (options?.interpolate === false) attrs += ' style="image-rendering:pixelated"'
    attrs += this.blendStyleAttr()
    this.sink.body.push(
      `<image x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}"${attrs}/>`,
    )
  }

  /** Frame + diagonal cross, same look as the Canvas backend placeholder */
  private drawImagePlaceholder(x: number, y: number, width: number, height: number): void {
    let attrs = ' fill="none" stroke="#CCCCCC" stroke-width="0.5"'
    if (this.alpha < 1) attrs += ` stroke-opacity="${fmt(this.alpha)}"`
    attrs += this.blendStyleAttr()
    const body = this.sink.body
    body.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}"${attrs}/>`)
    body.push(
      `<path d="M${fmt(x)} ${fmt(y)}L${fmt(x + width)} ${fmt(y + height)}M${fmt(x + width)} ${fmt(y)}L${fmt(x)} ${fmt(y + height)}"${attrs}/>`,
    )
  }

  // ─── Glyph drawing via the font engine ───

  private drawTextWithFont(
    x: number, y: number,
    text: string,
    font: Font, fontSize: number, color: string,
    options?: TextDrawOptions,
  ): void {
    // Apply Variable Font axis values
    if (options?.variation) {
      font.setVariation(options.variation)
    }

    const m = font.metrics
    const s = fontSize / m.unitsPerEm
    const ascent = m.ascender * s
    const isVertical = options?.writingMode === 'vertical-rl' || options?.writingMode === 'vertical-lr'
    const horizontalScale = isVertical ? 1 : (options?.horizontalScale ?? 1)

    // Determine synthetic Bold/Italic
    const needsSyntheticBold = !!options?.bold && !m.isBold
    const needsSyntheticItalic = !!options?.italic && !m.isItalic
    const slant = needsSyntheticItalic ? Math.tan(12 * Math.PI / 180) : 0
    const boldWidth = needsSyntheticBold ? fontSize * 0.025 : 0
    const textPaintMode = options?.textPaintMode ?? 'fill'
    const textStrokeColor = toDisplayColor(options?.textStrokeColor ?? color)
    const textStrokeWidth = options?.textStrokeWidth ?? 1
    const nonFillTextPaint = textPaintMode !== 'fill'

    // Shaped glyph run: provided by the layout engine, or shaped here for direct
    // vertical calls (vertical alternates vert/vrt2 apply to every vertical path).
    // When a run is present, its advances are authoritative (spacing already baked in).
    const presetGlyphIds = options?.glyphIds
    let run = options?.glyphRun
    if (!run && isVertical && !(presetGlyphIds && presetGlyphIds.length > 0)) {
      run = shapeGlyphRun(font, text, fontSize, options?.letterSpacing ?? 0, 0, true, 1, options?.direction ?? 'ltr')
    }
    const letterSpacing = run ? 0 : (options?.letterSpacing ?? 0)

    // Collect glyphs + compute width/height. A bitmap-only font (no glyf/CFF)
    // has no scalable outline; its glyphs are drawn from embedded bitmaps in the
    // draw loop (drawSvgOrBitmapGlyph), so the outline is left empty here rather
    // than calling getGlyph, which would throw for a missing 'glyf'.
    const hasOutlines = font.hasScalableOutlines
    const glyphs: SvgGlyphInfo[] = []
    let textExtent = 0
    if (run) {
      const runGlyphIds = run.glyphIds
      for (let gi = 0; gi < runGlyphIds.length; gi++) {
        const gid = runGlyphIds[gi]!
        const override = run.outlineOverrides?.[gi] ?? null
        const glyph = override === null && hasOutlines ? font.getGlyph(gid) : null
        const advance = run.advances[gi]!
        glyphs.push({
          gid,
          advanceWidth: font.getAdvanceWidth(gid) * s,
          advance,
          xOffset: run.xOffsets[gi]!,
          yOffset: run.yOffsets[gi]!,
          commands: override?.commands ?? glyph?.outline.commands ?? EMPTY_GLYPH_COMMANDS,
          coords: override?.coords ?? glyph?.outline.coords ?? EMPTY_GLYPH_COORDS,
          xScale: run.xScales?.[gi] ?? 1,
          yScale: run.yScales?.[gi] ?? 1,
          rotation: run.rotations?.[gi] === 90 ? 90 : 0,
        })
        textExtent += advance
      }
    } else {
      let gi2 = 0
      for (let ti = 0; ti < text.length; ti++) {
        let cp = text.charCodeAt(ti)
        if (cp >= 0xD800 && cp <= 0xDBFF && ti + 1 < text.length) {
          const lo = text.charCodeAt(ti + 1)
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            cp = ((cp - 0xD800) << 10) + (lo - 0xDC00) + 0x10000
            ti++
          }
        }
        const gid = presetGlyphIds && gi2 < presetGlyphIds.length ? presetGlyphIds[gi2]! : font.getGlyphId(cp)
        const glyph = hasOutlines ? font.getGlyph(gid) : null
        const aw = font.getAdvanceWidth(gid) * s
        const advance = isVertical ? font.getAdvanceHeight(gid) * s : (aw + letterSpacing) * horizontalScale
        glyphs.push({ gid, advanceWidth: aw, advance, xOffset: 0, yOffset: 0, commands: glyph ? glyph.outline.commands : EMPTY_GLYPH_COMMANDS, coords: glyph ? glyph.outline.coords : EMPTY_GLYPH_COORDS, xScale: 1, yScale: 1, rotation: 0 })
        textExtent += advance
        gi2++
      }
    }

    // hAlign (horizontal writing only)
    let drawX = x
    if (!isVertical && options?.hAlign && options.width) {
      if (options.hAlign === 'center') {
        drawX = x + (options.width - textExtent) / 2
      } else if (options.hAlign === 'right') {
        drawX = x + options.width - textExtent
      }
    }

    // Draw glyph outlines as paths
    // Font coordinates: Y-up → SVG: Y-down (flipped)
    // Draw each glyph as a separate path (prevents winding interference between subpaths)
    const baseY = y + (options?.baselineOffset ?? ascent)

    let cx = drawX
    let cy = baseY
    for (let gi = 0; gi < glyphs.length; gi++) {
      const g = glyphs[gi]!
      // Compute glyph origin adjustment for vertical writing
      let glyphCx = cx
      let glyphCy = cy
      if (isVertical) {
        const halfAw = g.advanceWidth / 2
        const vOriginY = font.getVerticalOrigin(g.gid) * s
        glyphCx = cx + fontSize / 2 - halfAw + g.xOffset
        glyphCy = cy - ascent + vOriginY - g.yOffset
      } else {
        // Apply GPOS placement offsets (mark positioning etc.)
        glyphCx = cx + g.xOffset
        glyphCy = cy - g.yOffset
      }

      const mergeGroup = run?.mergeGroups?.[gi] ?? 0
      if (mergeGroup !== 0) {
        const outlines: PositionedGlyphOutline[] = []
        let groupCx = cx
        let groupCy = cy
        let end = gi
        while (end < glyphs.length && run!.mergeGroups![end] === mergeGroup) {
          const member = glyphs[end]!
          let originX = groupCx + member.xOffset
          let originY = groupCy - member.yOffset
          if (isVertical) {
            originX = groupCx + fontSize / 2 - member.advanceWidth / 2 + member.xOffset
            originY = groupCy - ascent + font.getVerticalOrigin(member.gid) * s - member.yOffset
          }
          outlines.push({
            outline: { commands: member.commands, coords: member.coords },
            originX,
            originY,
            xScale: member.xScale,
            yScale: member.yScale,
            rotation: member.rotation,
          })
          if (isVertical) groupCy += member.advance
          else groupCx += member.advance
          end++
        }
        const merged = mergePositionedGlyphOutlines(outlines, s, horizontalScale, slant)
        this.emitGlyphPath(merged.commands, merged.coords, 0, 0, 1, 1, color, 0, boldWidth, textPaintMode, textStrokeColor, textStrokeWidth)
        cx = groupCx
        cy = groupCy
        gi = end - 1
        continue
      }

      if (g.xScale !== 1 || g.yScale !== 1 || g.rotation === 90) {
        const rotate = g.rotation === 90 ? ' rotate(90)' : ''
        this.sink.body.push(`<g transform="translate(${fmt(glyphCx)} ${fmt(glyphCy)})${rotate} scale(${fmt(g.xScale)} ${fmt(g.yScale)}) translate(${fmt(-glyphCx)} ${fmt(-glyphCy)})">`)
      }

      // COLR v1 check
      const hasOutlineOverride = run?.outlineOverrides?.[gi] != null
      const paintTree = hasOutlineOverride || nonFillTextPaint || !font.hasColrGlyphs ? null : font.getPaintTree(g.gid)
      if (paintTree) {
        const fg = parseForegroundColor(color)
        const colrOps = new SvgColrV1Ops(this.sink, this.alpha, this.blendStyleAttr())
        renderColrV1Glyph(font, g.gid, colrOps, s, glyphCx, glyphCy, fg)
      } else {
        // Color layer check (COLR v0)
        const colorLayers = hasOutlineOverride || nonFillTextPaint || !font.hasColrGlyphs ? null : font.getColorLayers(g.gid)
        if (colorLayers && colorLayers.length > 0) {
          for (let li = 0; li < colorLayers.length; li++) {
            const layer = colorLayers[li]!
            const layerGlyph = font.getGlyph(layer.glyphId)
            let layerColor = color
            if (layer.paletteIndex !== 0xFFFF) {
              const c = font.getColorFromSelectedPalette(layer.paletteIndex)
              if (c) {
                layerColor = `rgba(${c.r},${c.g},${c.b},${c.a / 255})`
              }
            }
            this.emitGlyphPath(layerGlyph.outline.commands, layerGlyph.outline.coords, glyphCx, glyphCy, s, horizontalScale, layerColor, slant, boldWidth, textPaintMode, textStrokeColor, textStrokeWidth)
          }
        } else if (hasOutlineOverride || nonFillTextPaint || !this.drawSvgOrBitmapGlyph(font, g.gid, glyphCx, glyphCy, fontSize, s, color, isVertical)) {
          // Regular monochrome drawing
          this.emitGlyphPath(g.commands, g.coords, glyphCx, glyphCy, s, horizontalScale, color, slant, boldWidth, textPaintMode, textStrokeColor, textStrokeWidth)
        }
      }
      if (g.xScale !== 1 || g.yScale !== 1 || g.rotation === 90) this.sink.body.push('</g>')
      if (isVertical) {
        cy += g.advance
      } else {
        cx += g.advance
      }
    }

    // Underline (horizontal writing only)
    if (options?.underline && !isVertical) {
      const ulPos = m.underlinePosition * s
      const ulThick = Math.max(m.underlineThickness * s, 0.5)
      this.emitDecorationLine(drawX, drawX + textExtent, baseY - ulPos, color, ulThick)
    }

    // Strikethrough (horizontal writing only)
    if (options?.strikethrough && !isVertical) {
      const strikeY = baseY - m.strikeoutPosition * s
      const strikeThick = Math.max(m.strikeoutSize * s, 0.5)
      this.emitDecorationLine(drawX, drawX + textExtent, strikeY, color, strikeThick)
    }

    // Reset Variable Font axis values
    if (options?.variation) {
      font.setVariation({})
    }
  }

  /**
   * Draws an OT-SVG or embedded bitmap glyph following the color font
   * priority order (COLR handled by the caller): SVG → sbix/CBDT/EBDT.
   * The OT-SVG document is expanded into native SVG primitives.
   * @returns true when the glyph was drawn
   */
  private drawSvgOrBitmapGlyph(
    font: Font, gid: number,
    glyphCx: number, glyphCy: number,
    fontSize: number, s: number, color: string, vertical: boolean,
  ): boolean {
    const svgSource = font.hasSvgGlyphs ? font.getSvgGlyphDocument(gid) : null
    if (svgSource !== null) {
      let doc = this.svgGlyphDocCache.get(svgSource)
      if (!doc) {
        doc = parseOpenTypeSvg(svgSource)
        this.svgGlyphDocCache.set(svgSource, doc)
      }
      renderSvgGlyph(doc, this, gid, glyphCx, glyphCy, s, font.metrics.unitsPerEm, { foregroundColor: color, paletteFont: font })
      return true
    }

    if (!font.hasEmbeddedBitmapGlyphs) return false
    const bitmap = prepareBitmapGlyph(font, gid, fontSize, fontSize, color, fontSize, 1, vertical)
    if (bitmap) {
      this.drawImageData(
        glyphCx + bitmap.left, glyphCy + bitmap.top,
        bitmap.width, bitmap.height,
        bitmap.data, bitmap.mimeType,
      )
      return !bitmap.drawOutlines
    }

    return false
  }

  /** Emit a glyph outline as a filled <path> (with synthetic bold/italic) */
  private emitGlyphPath(
    commands: Uint8Array, coords: Float32Array,
    cx: number, baseY: number, s: number, horizontalScale: number, color: string,
    slant: number, boldWidth: number,
    paintMode: 'fill' | 'stroke' | 'fillStroke' = 'fill', strokeColor = color, strokeWidth = 1,
  ): void {
    const d = glyphOutlineToPathD(commands, coords, cx, baseY, s, horizontalScale, slant)
    if (!d) return
    let attrs = paintMode === 'stroke' ? ' fill="none"' : ` fill="${escapeXmlAttr(color)}"`
    if (paintMode !== 'stroke' && this.alpha < 1) attrs += ` fill-opacity="${fmt(this.alpha)}"`
    if (paintMode !== 'fill') {
      attrs += ` stroke="${escapeXmlAttr(strokeColor)}" stroke-width="${fmt(strokeWidth)}" stroke-linejoin="round"`
      if (this.alpha < 1) attrs += ` stroke-opacity="${fmt(this.alpha)}"`
    } else if (boldWidth) {
      // Synthetic bold: fill + stroke with the same color (Canvas backend equivalent)
      attrs += ` stroke="${escapeXmlAttr(color)}" stroke-width="${fmt(boldWidth)}" stroke-linejoin="round"`
      if (this.alpha < 1) attrs += ` stroke-opacity="${fmt(this.alpha)}"`
    }
    attrs += this.blendStyleAttr()
    this.sink.body.push(`<path d="${d}"${attrs}/>`)
  }

  /** Emit an underline/strikethrough segment */
  private emitDecorationLine(x1: number, x2: number, y: number, color: string, thickness: number): void {
    let attrs = ` stroke="${escapeXmlAttr(color)}" stroke-width="${fmt(thickness)}"`
    if (this.alpha < 1) attrs += ` stroke-opacity="${fmt(this.alpha)}"`
    attrs += this.blendStyleAttr()
    this.sink.body.push(`<line x1="${fmt(x1)}" y1="${fmt(y)}" x2="${fmt(x2)}" y2="${fmt(y)}"${attrs}/>`)
  }

  // ─── Text drawing with CSS fonts (fallback) ───

  private drawTextWithCSS(
    x: number, y: number,
    text: string,
    fontId: string, fontSize: number, color: string,
    options?: TextDrawOptions,
  ): void {
    // Without a Font instance the text cannot be measured here, so alignment
    // is delegated to text-anchor and the top baseline to dominant-baseline
    // (the SVG viewer resolves the metrics of the named CSS font).
    let drawX = x
    let anchorAttr = ''
    const horizontalScale = options?.horizontalScale ?? 1
    if (options?.hAlign && options.width) {
      if (options.hAlign === 'center') {
        drawX = x + options.width / 2
        anchorAttr = ' text-anchor="middle"'
      } else if (options.hAlign === 'right') {
        drawX = x + options.width
        anchorAttr = ' text-anchor="end"'
      }
    }

    const drawY = y + (options?.baselineOffset ?? 0)
    let attrs = horizontalScale === 1
      ? ` x="${fmt(drawX)}" y="${fmt(drawY)}"`
      : ` x="0" y="0" transform="translate(${fmt(drawX)} ${fmt(drawY)}) scale(${fmt(horizontalScale)} 1)"`
    const textPaintMode = options?.textPaintMode ?? 'fill'
    attrs += textPaintMode === 'stroke' ? ' fill="none"' : ` fill="${escapeXmlAttr(color)}"`
    if (textPaintMode !== 'fill') {
      attrs += ` stroke="${escapeXmlAttr(toDisplayColor(options?.textStrokeColor ?? color))}" stroke-width="${fmt(options?.textStrokeWidth ?? 1)}"`
    }
    attrs += ` font-family="${escapeXmlAttr(fontId)}" font-size="${fmt(fontSize)}"`
      + (options?.baselineOffset === undefined ? ' dominant-baseline="text-before-edge"' : ' dominant-baseline="alphabetic"')
      + anchorAttr
    if (options?.bold) attrs += ' font-weight="bold"'
    if (options?.italic) attrs += ' font-style="italic"'
    if (options?.letterSpacing) attrs += ` letter-spacing="${fmt(options.letterSpacing)}"`
    if (options?.underline || options?.strikethrough) {
      const deco = options.underline
        ? (options.strikethrough ? 'underline line-through' : 'underline')
        : 'line-through'
      attrs += ` text-decoration="${deco}"`
    }
    if (this.alpha < 1) {
      if (textPaintMode !== 'stroke') attrs += ` fill-opacity="${fmt(this.alpha)}"`
      if (textPaintMode !== 'fill') attrs += ` stroke-opacity="${fmt(this.alpha)}"`
    }
    attrs += this.blendStyleAttr()
    this.sink.body.push(`<text${attrs} xml:space="preserve">${escapeXmlText(text)}</text>`)
  }
}

// ─── COLR v1 SVG implementation ───

/**
 * ColrV1PaintOps implementation for SVG output.
 *
 * Mirrors the Canvas ops: clip operations both clip and set the current path
 * (Canvas keeps the constructed path after clip(), and fills paint that path),
 * fills emit a <path> for the current path, and the sweep gradient is
 * approximated with the same 360-sector subdivision as the Canvas backend.
 */
class SvgColrV1Ops implements ColrV1PaintOps {
  private sink: SvgPageSink
  private alpha: number
  private blendStyle: string
  /**
   * Current path in device coordinates. Like the Canvas current path it is
   * NOT part of the save/restore state.
   */
  private currentPathD: string | null = null
  /** Groups opened per save frame */
  private frames: number[] = []
  /** Whether each active composite mode opened a blend group */
  private compositeOpened: boolean[] = []

  constructor(sink: SvgPageSink, alpha: number, blendStyle: string) {
    this.sink = sink
    this.alpha = alpha
    this.blendStyle = blendStyle
  }

  save(): void {
    this.frames.push(0)
  }

  restore(): void {
    const n = this.frames.pop()!
    const body = this.sink.body
    for (let i = 0; i < n; i++) body.push('</g>')
  }

  private openGroup(attrs: string): void {
    this.sink.body.push(`<g ${attrs}>`)
    const top = this.frames.length - 1
    this.frames[top] = this.frames[top]! + 1
  }

  transform(xx: number, yx: number, xy: number, yy: number, dx: number, dy: number): void {
    this.openGroup(`transform="matrix(${fmt(xx)} ${fmt(yx)} ${fmt(xy)} ${fmt(yy)} ${fmt(dx)} ${fmt(dy)})"`)
  }

  private applyClip(d: string): void {
    const sink = this.sink
    const id = `cv${sink.idCounter++}`
    sink.defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`)
    this.openGroup(`clip-path="url(#${id})"`)
    this.currentPathD = d
  }

  clipGlyph(font: Font, glyphId: number, scale: number, cx: number, baseY: number): void {
    const glyph = font.getGlyph(glyphId)
    const { commands, coords } = glyph.outline
    if (commands.length === 0) return
    this.applyClip(glyphOutlineToPathD(commands, coords, cx, baseY, scale, 1, 0))
  }

  clipRect(xMin: number, yMin: number, xMax: number, yMax: number, scale: number, cx: number, baseY: number): void {
    const x = cx + xMin * scale
    const y = baseY - yMax * scale
    const w = (xMax - xMin) * scale
    const h = (yMax - yMin) * scale
    this.applyClip(`M${fmt(x)} ${fmt(y)}L${fmt(x + w)} ${fmt(y)}L${fmt(x + w)} ${fmt(y + h)}L${fmt(x)} ${fmt(y + h)}Z`)
  }

  /** Fill the current path with the given SVG paint value */
  private emitFill(fillValue: string, paintAlpha: number): void {
    // An empty current path fills nothing (same as Canvas ctx.fill())
    if (this.currentPathD === null) return
    let attrs = ` fill="${fillValue}"`
    const a = this.alpha * paintAlpha
    if (a < 1) attrs += ` fill-opacity="${fmt(a)}"`
    attrs += this.blendStyle
    this.sink.body.push(`<path d="${this.currentPathD}"${attrs}/>`)
  }

  fillSolid(color: ResolvedColor): void {
    this.emitFill(resolvedColorToSvg(color), color.a)
  }

  fillLinearGradient(
    x0: number, y0: number, x1: number, y1: number,
    _x2: number, _y2: number,
    stops: ResolvedColorStop[], extend: ExtendMode,
    scale: number, cx: number, baseY: number,
  ): void {
    const sink = this.sink
    const id = `gv${sink.idCounter++}`
    const gx0 = cx + x0 * scale
    const gy0 = baseY - y0 * scale
    const gx1 = cx + x1 * scale
    const gy1 = baseY - y1 * scale
    // repeat/reflect map to the native SVG spreadMethod
    sink.defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(gx0)}" y1="${fmt(gy0)}" x2="${fmt(gx1)}" y2="${fmt(gy1)}"${extendToSpreadAttr(extend)}>${colrStopsToSvg(stops)}</linearGradient>`,
    )
    this.emitFill(`url(#${id})`, 1)
  }

  fillRadialGradient(
    x0: number, y0: number, r0: number,
    x1: number, y1: number, r1: number,
    stops: ResolvedColorStop[], extend: ExtendMode,
    scale: number, cx: number, baseY: number,
  ): void {
    const sink = this.sink
    const id = `gv${sink.idCounter++}`
    const fx = cx + x0 * scale
    const fy = baseY - y0 * scale
    const fr = r0 * scale
    const gcx = cx + x1 * scale
    const gcy = baseY - y1 * scale
    const gr = r1 * scale
    sink.defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(gcx)}" cy="${fmt(gcy)}" r="${fmt(gr)}" fx="${fmt(fx)}" fy="${fmt(fy)}" fr="${fmt(fr)}"${extendToSpreadAttr(extend)}>${colrStopsToSvg(stops)}</radialGradient>`,
    )
    this.emitFill(`url(#${id})`, 1)
  }

  fillSweepGradient(
    centerX: number, centerY: number,
    startAngle: number, endAngle: number,
    stops: ResolvedColorStop[], extend: ExtendMode,
    scale: number, cx: number, baseY: number,
  ): void {
    // Approximate the sweep gradient by drawing it in sector subdivisions,
    // identical to the Canvas backend approach (sectors are bounded by the
    // active glyph clip)
    const px = cx + centerX * scale
    const py = baseY - centerY * scale

    // Convert angles from turns → radians (sign flipped due to Y-axis inversion)
    const startRad = -startAngle * 2 * Math.PI
    const endRad = -endAngle * 2 * Math.PI

    const SECTORS = 360
    const totalAngle = endRad - startRad
    const stepAngle = totalAngle / SECTORS
    const R = 4000
    const sweepFlag = stepAngle >= 0 ? '1' : '0'

    const firstOff = stops[0]?.offset ?? 0
    const lastOff = stops[stops.length - 1]?.offset ?? 1

    const body = this.sink.body
    for (let i = 0; i < SECTORS; i++) {
      const a0 = startRad + stepAngle * i
      const a1 = a0 + stepAngle
      const t = (i + 0.5) / SECTORS

      const mapped = extend !== 0
        ? mapExtendMode(t, firstOff, lastOff, extend)
        : t
      const color = sampleColorLine(stops, mapped)

      const x0 = px + R * Math.cos(a0)
      const y0 = py + R * Math.sin(a0)
      const x1 = px + R * Math.cos(a1)
      const y1 = py + R * Math.sin(a1)
      let attrs = ` fill="${resolvedColorToSvg(color)}"`
      const a = this.alpha * color.a
      if (a < 1) attrs += ` fill-opacity="${fmt(a)}"`
      attrs += this.blendStyle
      body.push(
        `<path d="M${fmt(px)} ${fmt(py)}L${fmt(x0)} ${fmt(y0)}A${R} ${R} 0 0 ${sweepFlag} ${fmt(x1)} ${fmt(y1)}Z"${attrs}/>`,
      )
    }
  }

  setCompositeMode(mode: CompositeMode): void {
    const blend = compositeModeToBlend(mode)
    if (blend) {
      this.openGroup(`style="mix-blend-mode:${blend}"`)
      this.compositeOpened.push(true)
    } else {
      // SVG format constraint: Porter-Duff composite modes (CLEAR/SRC/DEST_IN
      // etc.) have no SVG element compositing equivalent, so those sources are
      // drawn with normal (source-over) compositing.
      this.compositeOpened.push(false)
    }
  }

  resetCompositeMode(): void {
    if (this.compositeOpened.pop()) {
      this.sink.body.push('</g>')
      const top = this.frames.length - 1
      this.frames[top] = this.frames[top]! - 1
    }
  }
}

/**
 * CompositeMode → mix-blend-mode mapping.
 * Separable/non-separable blend modes map directly; Porter-Duff modes return
 * null (not expressible with SVG element compositing) and fall back to normal
 * compositing.
 */
function compositeModeToBlend(mode: CompositeMode): string | null {
  switch (mode as number) {
    case 12: return 'plus-lighter'   // PLUS
    case 13: return 'screen'         // SCREEN
    case 14: return 'overlay'        // OVERLAY
    case 15: return 'darken'         // DARKEN
    case 16: return 'lighten'        // LIGHTEN
    case 17: return 'color-dodge'    // COLOR_DODGE
    case 18: return 'color-burn'     // COLOR_BURN
    case 19: return 'hard-light'     // HARD_LIGHT
    case 20: return 'soft-light'     // SOFT_LIGHT
    case 21: return 'difference'     // DIFFERENCE
    case 22: return 'exclusion'      // EXCLUSION
    case 23: return 'multiply'       // MULTIPLY
    case 24: return 'hue'            // HUE
    case 25: return 'saturation'     // SATURATION
    case 26: return 'color'          // COLOR
    case 27: return 'luminosity'     // LUMINOSITY
    default: return null             // SRC_OVER and Porter-Duff modes
  }
}

/** ExtendMode → spreadMethod attribute (0=pad is the SVG default) */
function extendToSpreadAttr(extend: ExtendMode): string {
  if (extend === 1) return ' spreadMethod="repeat"'
  if (extend === 2) return ' spreadMethod="reflect"'
  return ''
}

/** Serialize resolved COLR stops as <stop> elements (clamped, monotonic offsets) */
function colrStopsToSvg(stops: ResolvedColorStop[]): string {
  let out = ''
  let prev = 0
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]!
    let off = clamp01(s.offset)
    if (i > 0 && off < prev) off = prev
    prev = off
    out += `<stop offset="${fmt(off)}" stop-color="${resolvedColorToSvg(s.color)}"`
    if (s.color.a < 1) out += ` stop-opacity="${fmt(clamp01(s.color.a))}"`
    out += '/>'
  }
  return out
}

/** ResolvedColor → opaque rgb() string (alpha is emitted as a separate opacity attribute) */
function resolvedColorToSvg(c: ResolvedColor): string {
  return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`
}

// ─── Path serialization ───

/**
 * Serialize a glyph outline to an SVG d string in device coordinates.
 * Same transform as the Canvas backend: x' = cx + (fx + fy*slant) * s,
 * y' = baseY - fy * s (font Y-up → SVG Y-down).
 */
function glyphOutlineToPathD(
  commands: Uint8Array, coords: Float32Array,
  cx: number, baseY: number, s: number, horizontalScale: number, slant: number,
): string {
  if (commands.length === 0) return ''
  const parts: string[] = []
  const t = slant
  let ci = 0
  for (let i = 0; i < commands.length; i++) {
    switch (commands[i]) {
      case 0: { // MoveTo
        const fx = coords[ci]!, fy = coords[ci + 1]!
        parts.push(`M${fmt(cx + (fx + fy * t) * s * horizontalScale)} ${fmt(baseY - fy * s)}`)
        ci += 2
        break
      }
      case 1: { // LineTo
        const fx = coords[ci]!, fy = coords[ci + 1]!
        parts.push(`L${fmt(cx + (fx + fy * t) * s * horizontalScale)} ${fmt(baseY - fy * s)}`)
        ci += 2
        break
      }
      case 2: { // CubicTo
        const fx1 = coords[ci]!, fy1 = coords[ci + 1]!
        const fx2 = coords[ci + 2]!, fy2 = coords[ci + 3]!
        const fx3 = coords[ci + 4]!, fy3 = coords[ci + 5]!
        parts.push(
          `C${fmt(cx + (fx1 + fy1 * t) * s * horizontalScale)} ${fmt(baseY - fy1 * s)} ${fmt(cx + (fx2 + fy2 * t) * s * horizontalScale)} ${fmt(baseY - fy2 * s)} ${fmt(cx + (fx3 + fy3 * t) * s * horizontalScale)} ${fmt(baseY - fy3 * s)}`,
        )
        ci += 6
        break
      }
      case 3: // Close
        parts.push('Z')
        break
    }
  }
  return parts.join('')
}

/** Rounded rectangle path with per-corner radii (clockwise, A arcs) */
function roundedRectPathD(x: number, y: number, w: number, h: number, radii: ResolvedRectCornerRadii): string {
  const tl = radii.topLeft
  const tr = radii.topRight
  const br = radii.bottomRight
  const bl = radii.bottomLeft
  const parts: string[] = [`M${fmt(x + tl)} ${fmt(y)}`, `L${fmt(x + w - tr)} ${fmt(y)}`]
  if (tr > 0) parts.push(`A${fmt(tr)} ${fmt(tr)} 0 0 1 ${fmt(x + w)} ${fmt(y + tr)}`)
  parts.push(`L${fmt(x + w)} ${fmt(y + h - br)}`)
  if (br > 0) parts.push(`A${fmt(br)} ${fmt(br)} 0 0 1 ${fmt(x + w - br)} ${fmt(y + h)}`)
  parts.push(`L${fmt(x + bl)} ${fmt(y + h)}`)
  if (bl > 0) parts.push(`A${fmt(bl)} ${fmt(bl)} 0 0 1 ${fmt(x)} ${fmt(y + h - bl)}`)
  parts.push(`L${fmt(x)} ${fmt(y + tl)}`)
  if (tl > 0) parts.push(`A${fmt(tl)} ${fmt(tl)} 0 0 1 ${fmt(x + tl)} ${fmt(y)}`)
  parts.push('Z')
  return parts.join('')
}

/** DeviceRGB (0-1) triple to a #rrggbb hex string (for soft-mask backdrops). */
function rgb01ToHex(rgb: [number, number, number]): string {
  const to255 = (v: number): string => {
    const n = Math.max(0, Math.min(255, Math.round(v * 255)))
    return n.toString(16).padStart(2, '0')
  }
  return `#${to255(rgb[0])}${to255(rgb[1])}${to255(rgb[2])}`
}

/** Samples a transfer-function calculator expression into a space-separated
 *  feComponentTransfer tableValues string (17 points over 0..1, clamped). */
function buildSvgTransferTable(transfer: RenderTransferFunction): string {
  const n = 17
  const values: string[] = []
  for (let i = 0; i < n; i++) {
    const out = evaluateTransferFunctionDef(transfer, i / (n - 1))
    values.push(fmt(out < 0 ? 0 : out > 1 ? 1 : out))
  }
  return values.join(' ')
}

// ─── Gradient normalization (Canvas backend port) ───

function normalizeGradientStops(stops: GradientStop[]): GradientStop[] {
  stops = stops.map(function (stop) { return { ...stop, color: toDisplayColor(stop.color) } })
  if (stops.length === 0) {
    return [{ offset: 0, color: '#000000' }]
  }
  const normalized: GradientStop[] = []
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]!
    if (!Number.isFinite(s.offset)) continue
    const rawOffset = clamp01(s.offset)
    const offset = normalized.length > 0
      ? Math.max(rawOffset, normalized[normalized.length - 1]!.offset)
      : rawOffset
    normalized.push({
      offset,
      color: s.color,
      opacity: clamp01(s.opacity ?? 1),
    })
  }
  if (normalized.length === 0) return [{ offset: 0, color: '#000000' }]
  if (normalized[0]!.offset > 0) {
    const first = normalized[0]!
    normalized.unshift({ offset: 0, color: first.color, opacity: first.opacity })
  }
  if (normalized[normalized.length - 1]!.offset < 1) {
    const last = normalized[normalized.length - 1]!
    normalized.push({ offset: 1, color: last.color, opacity: last.opacity })
  }
  return normalized
}

// ─── Utilities ───

/** Format a coordinate/scalar: max 3 decimals, no trailing zeros */
function fmt(v: number): string {
  if (Number.isInteger(v)) return v.toString()
  const s = v.toFixed(3)
  let end = s.length
  while (s.charCodeAt(end - 1) === 0x30 /* 0 */) end--
  if (s.charCodeAt(end - 1) === 0x2E /* . */) end--
  const trimmed = s.slice(0, end)
  return trimmed === '-0' ? '0' : trimmed
}

/** Join a number list with spaces (for dash arrays) */
function joinNumbers(values: number[]): string {
  let out = fmt(values[0]!)
  for (let i = 1; i < values.length; i++) out += ` ${fmt(values[i]!)}`
  return out
}

/** Escape an XML attribute value (& < > ") */
function escapeXmlAttr(value: string): string {
  let out = ''
  let last = 0
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    let rep: string | null = null
    if (c === 38) rep = '&amp;'
    else if (c === 60) rep = '&lt;'
    else if (c === 62) rep = '&gt;'
    else if (c === 34) rep = '&quot;'
    if (rep !== null) {
      out += value.slice(last, i) + rep
      last = i + 1
    }
  }
  if (last === 0) return value
  return out + value.slice(last)
}

/** Escape XML text content (& < >) */
function escapeXmlText(value: string): string {
  let out = ''
  let last = 0
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    let rep: string | null = null
    if (c === 38) rep = '&amp;'
    else if (c === 60) rep = '&lt;'
    else if (c === 62) rep = '&gt;'
    if (rep !== null) {
      out += value.slice(last, i) + rep
      last = i + 1
    }
  }
  if (last === 0) return value
  return out + value.slice(last)
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Pure base64 encoder (works in both Node.js and browsers) */
function bytesToBase64(data: Uint8Array): string {
  const len = data.length
  const parts: string[] = []
  let i = 0
  for (; i + 2 < len; i += 3) {
    const n = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!
    parts.push(
      BASE64_CHARS[(n >> 18) & 63]! + BASE64_CHARS[(n >> 12) & 63]!
      + BASE64_CHARS[(n >> 6) & 63]! + BASE64_CHARS[n & 63]!,
    )
  }
  if (i + 1 === len) {
    const n = data[i]! << 16
    parts.push(`${BASE64_CHARS[(n >> 18) & 63]!}${BASE64_CHARS[(n >> 12) & 63]!}==`)
  } else if (i + 2 === len) {
    const n = (data[i]! << 16) | (data[i + 1]! << 8)
    parts.push(`${BASE64_CHARS[(n >> 18) & 63]!}${BASE64_CHARS[(n >> 12) & 63]!}${BASE64_CHARS[(n >> 6) & 63]!}=`)
  }
  return parts.join('')
}

function rasterMimeType(format: RasterImageFormat): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'avif':
      return 'image/avif'
  }
}

function imageAffineToYDown(
  a: number, b: number, c: number, d: number, e: number, f: number,
): { a: number, b: number, c: number, d: number, e: number, f: number } {
  // M(y-up) * F(y-down->y-up), F = [1 0 0; 0 -1 1; 0 0 1]
  return {
    a,
    b,
    c: -c,
    d: -d,
    e: c + e,
    f: d + f,
  }
}

function hashBytesFNV1a(data: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function clamp01(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

function requireUncoloredTilingColor(paint: TilingPatternPaint): string {
  if (paint.color === undefined) throw new Error('Uncolored tiling patterns require a use-site color')
  return paint.color
}
