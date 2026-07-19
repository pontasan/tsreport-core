/**
 * Canvas 2D backend
 *
 * Draws to a CanvasRenderingContext2D-compatible context.
 * All coordinates are received in pt and converted by scale × devicePixelRatio.
 * The editor's zoom factor is controlled via the scale option.
 *
 * When Font instances are passed via the fonts option,
 * glyph outlines are drawn as paths (equivalent to font embedding).
 * If unspecified, falls back to CSS fonts (ctx.fillText).
 */

import type { Font } from '../font.js'
import { shapeGlyphRun } from '../measure/glyph-run.js'
import type {
  RenderBackend, TextDrawOptions, ShapeDrawOptions, RectDrawOptions, ResolvedRectCornerRadii,
  PathPaintOptions, PaintValue, GradientPaint, GradientStop, BlendMode, ImageDrawOptions,
  MeshGradientPaint, TilingPatternPaint, FunctionShadingPaint, TileGraphic, TileGroupGraphic, TransparencyGroupOptions,
} from './backend.js'
import type { PdfSpecialColorDef } from '../types/template.js'
import { hasRectCornerRadius, resolveRectCornerRadii } from './backend.js'
import type { RenderFormField } from './backend.js'
import { paintFormFieldAppearance } from './form-field-appearance.js'
import type { CompositeMode, ExtendMode } from '../parsers/tables/colr.js'
import { detectImageFormat } from '../image/image-utils.js'
import { resolveImageResource, type RasterImageFormat } from './image-resource.js'
import { parseOpenTypeSvg, parseSvg } from '../svg/svg-parser.js'
import { renderSvg, renderSvgGlyph } from '../svg/svg-renderer.js'
import { forEachPackedMeshCell, isComplexPaint, pathCoordsBounds, pathStrokeBounds, tessellateFunctionShading, tessellateMeshGradient, tileIndexRange, type PackedMeshFillCell } from './complex-paint.js'
import { rasterizePackedMesh } from './packed-mesh-raster.js'
import { toDisplayColor } from './color.js'
import type { SvgDocument } from '../svg/svg-types.js'
import { applyDeviceRasterToRgba, validateRenderDeviceParams } from './device-raster.js'
import { adjustPdfStrokePath, adjustPdfStrokeWidth, flattenPdfPath } from './pdf-scan-conversion.js'
import type { OverprintMode, RenderingIntent, RenderCalculatorFunction, RenderDeviceParams, RenderTransferFunction, RenderPageTransparencyGroup, RenderNode, RenderPage } from '../types/render.js'
import { BackendImageResources } from '../image-resource-map.js'
import { evaluateTransferFunctionDef } from '../pdf/pdf-function.js'
import { prepareBitmapGlyph } from './bitmap-glyph.js'
import { mergePositionedGlyphOutlines, type PositionedGlyphOutline } from './merged-glyph-outline.js'
import { compositePdfTransparencyObject, extractPdfTransparencyGroup } from './pdf-compositor.js'
import {
  compositePdfOverprintRgba,
  createPdfPrintColorTransform,
  resolvePdfPrintColor,
  type PdfOverprintPaint,
  type PdfPrintColorTransform,
} from './pdf-print-color.js'
import type { IccRenderingIntent } from '../pdf/icc-profile-reader.js'
import {
  renderColrV1Glyph, parseForegroundColor, colorToRgba, sampleColorLine,
  extendGradientStops, mapExtendMode,
  type ColrV1PaintOps, type ResolvedColor, type ResolvedColorStop,
} from './colr-v1-renderer.js'

// Empty outline for a bitmap-only glyph (drawn from its embedded bitmap instead).
const EMPTY_GLYPH_COMMANDS = new Uint8Array(0)
const EMPTY_GLYPH_COORDS = new Float32Array(0)

interface CachedCanvasGlyphPath {
  coords: Float32Array
  constructor: new () => any
  path: any
}

/** Cached font-unit paths shared by backend instances while their outlines live. */
const sharedCanvasGlyphPathCache = new WeakMap<Uint8Array, CachedCanvasGlyphPath>()

export interface CanvasBackendOptions {
  /** Scaling factor (default: 1.0) */
  scale?: number
  /** Device pixel ratio (default: globalThis.devicePixelRatio ?? 1) */
  devicePixelRatio?: number
  /** fontId → Font mapping (when specified, glyph outlines are drawn) */
  fonts?: Record<string, Font>
  /** Image resources (imageId → base64/data URI string or binary) */
  images?: Record<string, string | Uint8Array>
  /** Page background color (null for no background fill, default: '#FFFFFF') */
  background?: string | null
  /**
   * Page-space viewport rendered into this canvas. The page geometry and all
   * paint coordinate systems remain unchanged; only the final device surface
   * is cropped and translated. This is used by progressive/tiled previews of
   * very large pages.
   */
  viewport?: { x: number, y: number, width: number, height: number }
  /** CMYK output profile used by overprint and separation preview. */
  printOutputProfile?: { data: Uint8Array, renderingIntent?: IccRenderingIntent }
  /**
   * Applies TrueType/CFF hinting to glyph outlines at the effective raster
   * ppem (fontSize x scale x devicePixelRatio). Raster output only; PDF and
   * SVG stay unhinted vectors. (default: false)
   */
  hinting?: boolean
  /**
   * Called when raster images that were still loading during rendering become
   * ready. The owner re-renders the page; images are then drawn synchronously
   * from the cache with the correct stacking order and clipping.
   */
  onImagesReady?: () => void
  /** Explicit-revision cache shared across CanvasBackend instances. */
  renderCache?: CanvasRenderCache
}

interface RasterImageCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image: any
  state: 'loading' | 'ready' | 'error'
  /** Backends waiting for every raster image used by their pass to settle. */
  readyObservers: Set<RasterImageReadyObserver>
}

interface RasterImageReadyObserver {
  rasterImageSettled(): void
}

// Loaded images are shared across CanvasBackend instances: a re-render after
// onImagesReady constructs a new backend and must find the images ready.
const sharedRasterImageCache = new Map<string, RasterImageCacheEntry>()

/** Clears the shared raster image cache (releases loaded image elements). */
export function clearCanvasImageCache(): void {
  sharedRasterImageCache.clear()
}

/**
 * Canvas 2D backend
 *
 * Pass a CanvasRenderingContext2D to the constructor.
 * Only used in browser environments.
 */
export class CanvasBackend implements RenderBackend {
  readonly directSinglePaintGroupOpacity = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ctx: any
  private scale: number
  private dpr: number
  private fonts: Record<string, Font> | undefined
  private readonly imageResources: BackendImageResources
  private background: string | null
  private viewport: { x: number, y: number, width: number, height: number } | undefined
  private rasterImageCache = sharedRasterImageCache
  private pathDataCache = new Map<string, unknown>()
  private imageContentKeys = new Map<string, string>()
  private onImagesReady: (() => void) | undefined
  private pendingRasterImages = new Set<RasterImageCacheEntry>()
  private hinting: boolean
  /** OT-SVG glyph documents parsed once per document string */
  private svgGlyphDocCache = new Map<string, SvgDocument>()
  /** Transparency group / soft mask layer stack (A6.2/A6.3). */
  private layerStack: CanvasLayerFrame[] = []
  /** A finalized soft-mask layer awaiting the next beginTransparencyGroup. */
  private pendingMask: CanvasMaskLayer | null = null
  private renderingIntent: RenderingIntent = 'RelativeColorimetric'
  private alphaIsShape = false
  private textKnockout = true
  private overprintFill = false
  private overprintStroke = false
  private overprintMode: OverprintMode = 0
  private blendMode: BlendMode = 'normal'
  private graphicsStateStack: CanvasSemanticState[] = []
  private graphicsStateDepth = 0
  private pageTransparencyGroupActive = false
  private printColorTransform?: PdfPrintColorTransform
  private renderCache: CanvasRenderCache | undefined
  private contentCacheFrame: CanvasContentCacheFrame | null = null

  constructor(ctx: unknown, options?: CanvasBackendOptions) {
    this.ctx = ctx
    this.scale = options?.scale ?? 1.0
    this.fonts = options?.fonts
    this.imageResources = new BackendImageResources(options?.images)
    this.onImagesReady = options?.onImagesReady
    this.renderCache = options?.renderCache
    this.hinting = options?.hinting ?? false
    this.background = options?.background !== undefined ? options.background : '#FFFFFF'
    this.viewport = options?.viewport
    if (options?.printOutputProfile !== undefined) {
      this.printColorTransform = createPdfPrintColorTransform(
        options.printOutputProfile.data,
        options.printOutputProfile.renderingIntent,
      )
    }
    this.dpr = options?.devicePixelRatio
      ?? (typeof globalThis !== 'undefined' && 'devicePixelRatio' in globalThis
        ? (globalThis as Record<string, unknown>).devicePixelRatio as number
        : 1)
  }

  beginDocument(): void {
    this.imageResources.beginDocument()
    this.imageContentKeys.clear()
  }

  endDocument(): void {
    // Nothing to do for Canvas
  }

  beginPage(width: number, height: number, options?: { transparencyGroup?: RenderPageTransparencyGroup }): void {
    this.imageResources.beginPage()
    const ctx = this.ctx
    const s = this.scale
    const dpr = this.dpr
    const canvas = ctx.canvas
    this.alphaIsShape = false
    this.textKnockout = true
    this.renderingIntent = 'RelativeColorimetric'
    this.overprintFill = false
    this.overprintStroke = false
    this.overprintMode = 0
    this.blendMode = 'normal'
    this.graphicsStateDepth = 0
    this.pageTransparencyGroupActive = false

    const viewport = this.viewport
    const surfaceWidth = viewport?.width ?? width
    const surfaceHeight = viewport?.height ?? height

    // Set canvas size. A viewport changes only the device surface; the
    // renderer still traverses the original page with its original geometry.
    canvas.width = Math.ceil(surfaceWidth * s * dpr)
    canvas.height = Math.ceil(surfaceHeight * s * dpr)
    if (canvas.style) {
      canvas.style.width = `${surfaceWidth * s}px`
      canvas.style.height = `${surfaceHeight * s}px`
    }

    // Apply pt → pixel conversion and viewport origin in one transform. Paint
    // definitions (gradients, patterns, soft masks and affine images) keep
    // their page-space coordinates, avoiding seams or shear changes at tiles.
    const viewportOffsetX = viewport === undefined ? 0 : -viewport.x * s * dpr
    const viewportOffsetY = viewport === undefined ? 0 : -viewport.y * s * dpr
    ctx.setTransform(
      s * dpr, 0, 0, s * dpr,
      viewportOffsetX,
      viewportOffsetY,
    )

    // Drawing quality settings
    if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'

    // Page background
    if (this.background !== null) {
      ctx.fillStyle = this.background
      ctx.fillRect(0, 0, width, height)
    }
    if (options?.transparencyGroup !== undefined) {
      this.beginTransparencyGroup(width, height, {
        isolated: options.transparencyGroup.isolated === true,
        knockout: options.transparencyGroup.knockout === true,
        hasSoftMask: false,
      })
      this.pageTransparencyGroupActive = true
    }
  }

  endPage(): void {
    if (this.pageTransparencyGroupActive) {
      this.endTransparencyGroup()
      this.pageTransparencyGroupActive = false
    }
  }

  beginContentGroup(node: RenderNode, index: number, page: RenderPage): boolean | void {
    const cache = this.renderCache
    if (cache === undefined || page.transparencyGroup !== undefined) return
    let cacheKey: string | undefined
    let revision: number | undefined
    if (node.type === 'group' && node.cacheKey !== undefined && node.revision !== undefined) {
      cacheKey = `group:${page.cacheKey ?? ''}:${node.cacheKey}`
      revision = node.revision
    } else if (page.cacheKey !== undefined && page.revision !== undefined) {
      cacheKey = `page:${page.cacheKey}:${index}`
      revision = page.revision
    }
    if (cacheKey === undefined || revision === undefined) return

    const target = this.ctx
    const cached = cache.get(cacheKey, revision, target.canvas.width, target.canvas.height, this.scale, this.dpr)
    if (cached !== undefined) {
      target.save()
      target.setTransform(1, 0, 0, 1, 0, 0)
      target.drawImage(cached, 0, 0)
      target.restore()
      this.contentCacheFrame = { mode: 'reused' }
      return true
    }

    const layer = this.createLayer()
    this.contentCacheFrame = { mode: 'capture', cacheKey, revision, target, layer }
    this.ctx = layer.ctx
  }

  endContentGroup(): void {
    const frame = this.contentCacheFrame
    if (frame === null) return
    this.contentCacheFrame = null
    if (frame.mode === 'reused') return
    this.ctx = frame.target
    frame.target.save()
    frame.target.setTransform(1, 0, 0, 1, 0, 0)
    frame.target.drawImage(frame.layer.canvas, 0, 0)
    frame.target.restore()
    this.renderCache!.set(frame.cacheKey, frame.revision, frame.layer.canvas, this.scale, this.dpr)
  }

  save(): void {
    let state = this.graphicsStateStack[this.graphicsStateDepth]
    if (state === undefined) {
      state = {
        alphaIsShape: this.alphaIsShape,
        textKnockout: this.textKnockout,
        renderingIntent: this.renderingIntent,
        overprintFill: this.overprintFill,
        overprintStroke: this.overprintStroke,
        overprintMode: this.overprintMode,
        blendMode: this.blendMode,
      }
      this.graphicsStateStack.push(state)
    } else {
      state.alphaIsShape = this.alphaIsShape
      state.textKnockout = this.textKnockout
      state.renderingIntent = this.renderingIntent
      state.overprintFill = this.overprintFill
      state.overprintStroke = this.overprintStroke
      state.overprintMode = this.overprintMode
      state.blendMode = this.blendMode
    }
    this.graphicsStateDepth++
    this.ctx.save()
  }

  restore(): void {
    this.ctx.restore()
    if (this.graphicsStateDepth === 0) throw new Error('Canvas graphics-state stack underflow')
    const state = this.graphicsStateStack[--this.graphicsStateDepth]!
    this.alphaIsShape = state.alphaIsShape
    this.textKnockout = state.textKnockout
    this.renderingIntent = state.renderingIntent
    this.overprintFill = state.overprintFill
    this.overprintStroke = state.overprintStroke
    this.overprintMode = state.overprintMode
    this.blendMode = state.blendMode
  }

  translate(x: number, y: number): void {
    if (x === 0 && y === 0) return
    this.ctx.translate(x, y)
  }

  clip(x: number, y: number, width: number, height: number): void {
    const ctx = this.ctx
    ctx.beginPath()
    ctx.rect(x, y, width, height)
    ctx.clip()
  }

  clipPath(commands: Uint8Array, coords: Float32Array, fillRule?: 'nonzero' | 'evenodd'): void {
    this.buildPath(commands, coords)
    this.ctx.clip(fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
  }

  rotate(angle: number): void {
    this.ctx.rotate(angle * Math.PI / 180)
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0) return
    this.ctx.transform(a, b, c, d, e, f)
  }

  setOpacity(opacity: number): void {
    this.ctx.globalAlpha = opacity
    const object = this.activeTransparencyObject()
    if (object !== undefined) object.objectOpacity = opacity
  }

  setBlendMode(mode: BlendMode): void {
    this.blendMode = mode
    const object = this.activeTransparencyObject()
    if (object !== undefined) {
      object.blendMode = mode
      this.ctx.globalCompositeOperation = 'source-over'
    } else this.ctx.globalCompositeOperation = mode === 'normal' ? 'source-over' : mode
  }

  setOverprint(fill: boolean, stroke: boolean, mode: OverprintMode): void {
    this.overprintFill = fill
    this.overprintStroke = stroke
    this.overprintMode = mode
  }

  beginOverprintObject(): void {
    const layer = this.createLayer()
    this.layerStack.push({
      kind: 'overprint',
      target: this.ctx,
      layer,
      overprintFill: this.overprintFill,
      overprintStroke: this.overprintStroke,
      overprintMode: this.overprintMode,
      blendMode: this.blendMode,
      printPaints: [],
    })
    this.ctx = layer.ctx
  }

  endOverprintObject(): void {
    const frame = this.layerStack.pop()
    if (frame === undefined || frame.kind !== 'overprint') throw new Error('endOverprintObject without a matching beginOverprintObject')
    this.ctx = frame.target
    const width = frame.layer.canvas.width
    const height = frame.layer.canvas.height
    const source = frame.layer.ctx.getImageData(0, 0, width, height).data as Uint8ClampedArray
    const targetImage = frame.target.getImageData(0, 0, width, height)
    compositePdfOverprintRgba(
      targetImage.data,
      source,
      frame.printPaints!,
      frame.overprintFill === true,
      frame.overprintStroke === true,
      frame.overprintMode!,
      frame.blendMode ?? 'normal',
      this.printColorTransform,
    )
    frame.target.putImageData(targetImage, 0, 0)
  }

  setRenderingIntent(intent: RenderingIntent): void {
    this.renderingIntent = intent
  }

  setTransparencyParameters(alphaIsShape: boolean | undefined, textKnockout: boolean | undefined): void {
    if (alphaIsShape !== undefined) this.alphaIsShape = alphaIsShape
    if (textKnockout !== undefined) this.textKnockout = textKnockout
    const object = this.activeTransparencyObject()
    if (object !== undefined && alphaIsShape !== undefined) object.alphaIsShape = alphaIsShape
  }

  // ─── Transparency groups + soft masks (A6.2/A6.3) ───
  // Children are drawn into an offscreen layer that shares the current CTM,
  // then composited onto the target as a unit (constant alpha applied once,
  // soft mask applied via destination-in). This is the isolated transparency
  // group model; per-object globalAlpha would double-composite overlaps.

  /** Create an offscreen layer matching the current target's CTM. */
  private createLayer(boundsWidth?: number, boundsHeight?: number): CanvasLayer {
    const target = this.ctx
    const targetCanvas = target.canvas
    if (typeof target.getTransform !== 'function') {
      throw new Error('Canvas backend requires getTransform to composite transparency groups')
    }
    const m = target.getTransform()
    let originX = 0
    let originY = 0
    let wPx = targetCanvas.width
    let hPx = targetCanvas.height
    if (boundsWidth !== undefined && boundsHeight !== undefined) {
      const x0 = m.e
      const y0 = m.f
      const x1 = m.a * boundsWidth + m.e
      const y1 = m.b * boundsWidth + m.f
      const x2 = m.c * boundsHeight + m.e
      const y2 = m.d * boundsHeight + m.f
      const x3 = m.a * boundsWidth + m.c * boundsHeight + m.e
      const y3 = m.b * boundsWidth + m.d * boundsHeight + m.f
      const left = Math.max(0, Math.floor(Math.min(x0, x1, x2, x3)) - 1)
      const top = Math.max(0, Math.floor(Math.min(y0, y1, y2, y3)) - 1)
      const right = Math.min(targetCanvas.width, Math.ceil(Math.max(x0, x1, x2, x3)) + 1)
      const bottom = Math.min(targetCanvas.height, Math.ceil(Math.max(y0, y1, y2, y3)) + 1)
      originX = Math.min(left, Math.max(0, targetCanvas.width - 1))
      originY = Math.min(top, Math.max(0, targetCanvas.height - 1))
      wPx = Math.max(1, right - originX)
      hPx = Math.max(1, bottom - originY)
    }
    let canvas: CanvasLike
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const OffscreenCanvasCtor = (globalThis as any).OffscreenCanvas
    if (typeof OffscreenCanvasCtor === 'function') {
      canvas = new OffscreenCanvasCtor(wPx, hPx) as CanvasLike
    } else if (targetCanvas.ownerDocument && typeof targetCanvas.ownerDocument.createElement === 'function') {
      canvas = targetCanvas.ownerDocument.createElement('canvas') as CanvasLike
      canvas.width = wPx
      canvas.height = hPx
    } else {
      throw new Error('Canvas backend requires OffscreenCanvas or a DOM document to composite transparency groups')
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas backend could not create an offscreen 2D context for a transparency group')
    if (typeof ctx.setTransform !== 'function') {
      throw new Error('Canvas backend requires getTransform/setTransform to composite transparency groups')
    }
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e - originX, m.f - originY)
    if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true
    return { canvas, ctx, originX, originY }
  }

  beginSoftMask(type: 'luminosity' | 'alpha', width: number, height: number, backdrop?: [number, number, number], transferFunction?: 'Identity' | RenderTransferFunction): void {
    const layer = this.createLayer(width, height)
    if (type === 'luminosity') {
      const [red, green, blue] = backdrop ?? [0, 0, 0]
      layer.ctx.save()
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
      layer.ctx.globalAlpha = 1
      layer.ctx.globalCompositeOperation = 'source-over'
      layer.ctx.fillStyle = `rgb(${red * 255}, ${green * 255}, ${blue * 255})`
      layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height)
      layer.ctx.restore()
    }
    this.layerStack.push({ kind: 'mask', target: this.ctx, layer, maskType: type, backdrop, maskTransfer: transferFunction })
    this.ctx = layer.ctx
  }

  endSoftMask(): void {
    const frame = this.layerStack.pop()
    if (frame === undefined || frame.kind !== 'mask') throw new Error('endSoftMask without a matching beginSoftMask')
    this.ctx = frame.target
    this.pendingMask = {
      canvas: frame.layer.canvas,
      ctx: frame.layer.ctx,
      originX: frame.layer.originX,
      originY: frame.layer.originY,
      maskType: frame.maskType!,
      backdrop: frame.backdrop,
      transfer: frame.maskTransfer,
    }
  }

  beginTransparencyGroup(width: number, height: number, options: TransparencyGroupOptions): void {
    const parentGroup = this.activeTransparencyGroup()
    const parentObject = this.activeTransparencyObject()
    const targetLayer = this.layerForContext(this.ctx)
    // A nested group must retain its parent's device dimensions because the
    // PDF transparency compositor exchanges full-size shape buffers between
    // the nested group and its parent object. Top-level groups can be cropped
    // to their transformed bounds, avoiding page-sized allocations for small
    // semi-transparent PDF objects.
    const layer = parentGroup === undefined
      ? this.createLayer(width, height)
      : this.createLayer()
    const pixelCount = layer.canvas.width * layer.canvas.height
    const backdrop = new Uint8ClampedArray(pixelCount * 4)
    if (!options.isolated) {
      if (parentGroup !== undefined && parentObject !== undefined) {
        // The current object capture is transparent by design. A nested
        // non-isolated group nevertheless composites against the accumulated
        // parent-group backdrop, plus paints already made in this object.
        // Copy both in PDF painting order before extracting the group result.
        drawLocalCanvasLayer(layer, parentGroup.layer)
        drawLocalCanvasLayer(layer, targetLayer)
      } else drawCanvasLayer(layer, targetLayer)
      backdrop.set(layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height).data)
    }
    this.layerStack.push({
      kind: 'group', target: this.ctx, layer,
      isolated: options.isolated,
      knockout: options.knockout,
      opacity: options.opacity,
      blendMode: this.blendMode,
      mask: options.hasSoftMask ? this.pendingMask : null,
      initialBackdrop: backdrop,
      groupAlpha: new Uint8ClampedArray(pixelCount),
      groupShape: new Uint8ClampedArray(pixelCount),
    })
    this.pendingMask = null
    this.ctx = layer.ctx
  }

  endTransparencyGroup(): void {
    const frame = this.layerStack.pop()
    if (frame === undefined || frame.kind !== 'group') throw new Error('endTransparencyGroup without a matching beginTransparencyGroup')
    const target = frame.target
    this.ctx = target
    const content = frame.layer
    const image = content.ctx.getImageData(0, 0, content.canvas.width, content.canvas.height)
    extractPdfTransparencyGroup(image.data, frame.initialBackdrop!, frame.groupAlpha!, frame.isolated === true)
    content.ctx.putImageData(image, 0, 0)
    const parentObject = this.activeTransparencyObject()
    if (parentObject !== undefined) {
      parentObject.shapeOverride = {
        data: frame.groupShape!,
        width: content.canvas.width,
        height: content.canvas.height,
        x: content.originX,
        y: content.originY,
      }
    }
    if (frame.mask) applyCanvasMask(content, frame.mask)
    // Composite the finished layer onto the target in device pixels. The
    // target's clip (device space) and blend mode (set by the caller) still
    // apply; constant alpha is applied once to the whole layer.
    target.save()
    target.setTransform(1, 0, 0, 1, 0, 0)
    if (frame.opacity != null && frame.opacity < 1) target.globalAlpha = frame.opacity
    target.drawImage(content.canvas, content.originX, content.originY)
    target.restore()
  }

  beginTransparencyObject(): void {
    if (this.activeTransparencyGroup() === undefined) return
    const layer = this.createLayer()
    this.layerStack.push({
      kind: 'object', target: this.ctx, layer,
      blendMode: 'normal', alphaIsShape: this.alphaIsShape, objectOpacity: 1,
    })
    this.ctx = layer.ctx
  }

  endTransparencyObject(): void {
    const frame = this.layerStack[this.layerStack.length - 1]
    if (frame === undefined || frame.kind !== 'object') return
    this.layerStack.pop()
    this.ctx = frame.target
    const group = this.activeTransparencyGroup()
    if (group === undefined) throw new Error('Transparency object has no parent group')
    const width = frame.layer.canvas.width
    const height = frame.layer.canvas.height
    const source = frame.layer.ctx.getImageData(0, 0, width, height).data as Uint8ClampedArray
    const accumulatedImage = group.layer.ctx.getImageData(0, 0, width, height)
    const shape = frame.shapeOverride === undefined
      ? new Uint8ClampedArray(width * height)
      : placeShapeOverride(frame.shapeOverride, width, height)
    if (frame.shapeOverride === undefined) {
      const opacity = frame.objectOpacity ?? 1
      for (let pixel = 0, offset = 3; pixel < shape.length; pixel++, offset += 4) {
        const alpha = source[offset]!
        shape[pixel] = frame.alphaIsShape === true || opacity === 0
          ? alpha
          : Math.min(255, Math.round(alpha / opacity))
      }
    }
    compositePdfTransparencyObject(
      accumulatedImage.data,
      group.initialBackdrop!,
      source,
      group.groupAlpha!,
      group.groupShape!,
      shape,
      group.knockout === true,
      frame.blendMode ?? 'normal',
    )
    group.layer.ctx.putImageData(accumulatedImage, 0, 0)
  }

  beginDeviceParams(params: RenderDeviceParams): void {
    validateRenderDeviceParams(params)
    if (!deviceParamsRequireRaster(params)) {
      this.layerStack.push({
        kind: 'device', target: this.ctx, layer: this.layerForContext(this.ctx),
        deviceParams: params, deviceRaster: false,
      })
      return
    }
    const layer = this.createLayer()
    this.layerStack.push({ kind: 'device', target: this.ctx, layer, deviceParams: params, deviceRaster: true })
    this.ctx = layer.ctx
  }

  endDeviceParams(): void {
    const frame = this.layerStack.pop()
    if (frame === undefined || frame.kind !== 'device') throw new Error('endDeviceParams without a matching beginDeviceParams')
    this.ctx = frame.target
    if (frame.deviceRaster !== true) return
    applyCanvasDeviceTransfer(frame.layer.ctx, frame.deviceParams!, this.scale * this.dpr)
    frame.target.save()
    frame.target.setTransform(1, 0, 0, 1, 0, 0)
    frame.target.drawImage(frame.layer.canvas, 0, 0)
    frame.target.restore()
  }

  drawText(
    x: number, y: number,
    text: string,
    fontId: string, fontSize: number, color: string,
    options?: TextDrawOptions,
  ): void {
    const textPaintMode = options?.textPaintMode ?? 'fill'
    if (textPaintMode !== 'stroke') this.recordPrintPaint(color, false)
    if (textPaintMode !== 'fill') this.recordPrintPaint(options?.textStrokeColor ?? color, true)
    color = toDisplayColor(color)
    const ctx = this.ctx
    const knockoutLayer = this.textKnockout
      && ((typeof ctx.globalAlpha === 'number' && ctx.globalAlpha < 1)
        || (typeof ctx.globalCompositeOperation === 'string' && ctx.globalCompositeOperation !== 'source-over'))
    if (knockoutLayer) {
      const layer = this.createLayer()
      this.ctx = layer.ctx
      try {
        this.drawTextDirect(x, y, text, fontId, fontSize, color, options)
      } finally {
        this.ctx = ctx
      }
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(layer.canvas, 0, 0)
      ctx.restore()
      return
    }
    this.drawTextDirect(x, y, text, fontId, fontSize, color, options)
  }

  private drawTextDirect(
    x: number, y: number,
    text: string,
    fontId: string, fontSize: number, color: string,
    options?: TextDrawOptions,
  ): void {
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
    this.recordPrintPaint(color, true)
    color = toDisplayColor(color)
    const ctx = this.ctx
    ctx.beginPath()
    if (dash && dash.length > 0) {
      ctx.setLineDash(dash)
    }
    const width = this.canvasStrokeWidth(lineWidth)
    if (this.activeDeviceParams()?.strokeAdjustment === true) {
      const adjusted = adjustPdfStrokePath(new Float32Array([x1, y1, x2, y2]), lineWidth, this.deviceTransform())
      x1 = adjusted[0]!
      y1 = adjusted[1]!
      x2 = adjusted[2]!
      y2 = adjusted[3]!
    }
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.stroke()
    if (dash && dash.length > 0) {
      ctx.setLineDash([])
    }
  }

  drawFormField(x: number, y: number, width: number, height: number, field: RenderFormField): void {
    paintFormFieldAppearance(this, x, y, width, height, field, field.fieldType === 'checkbox' || field.fieldType === 'radio' ? field.checked === true : true)
  }

  drawRect(
    x: number, y: number, width: number, height: number,
    options?: RectDrawOptions,
  ): void {
    const ctx = this.ctx
    let radii: ResolvedRectCornerRadii | undefined
    let hasRoundedCorners = false
    if (hasRectCornerRadius(options)) {
      radii = resolveRectCornerRadii(width, height, options)
      hasRoundedCorners = radii.topLeft > 0
        || radii.topRight > 0
        || radii.bottomRight > 0
        || radii.bottomLeft > 0
    }

    if (options?.fill) {
      this.recordPrintPaint(options.fill, false)
      this.buildRectPath(x, y, width, height, radii, hasRoundedCorners)
      ctx.fillStyle = toDisplayColor(options.fill)
      const restoreOpacity = this.beginLocalOpacity(options.fillOpacity)
      ctx.fill(options.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
      if (restoreOpacity) ctx.restore()
    }
    if (options?.stroke) {
      this.recordPrintPaint(options.stroke, true)
      const adjusted = this.adjustedRect(x, y, width, height, options.strokeWidth ?? 1)
      this.buildRectPath(adjusted[0], adjusted[1], adjusted[2], adjusted[3], radii, hasRoundedCorners)
      ctx.strokeStyle = toDisplayColor(options.stroke)
      this.applyShapeStrokeStyle(options)
      const restoreOpacity = this.beginLocalOpacity(options.strokeOpacity)
      ctx.stroke()
      if (restoreOpacity) ctx.restore()
    }
  }

  drawEllipse(
    cx: number, cy: number, rx: number, ry: number,
    options?: ShapeDrawOptions,
  ): void {
    const ctx = this.ctx
    if (options?.fill) {
      this.recordPrintPaint(options.fill, false)
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.fillStyle = toDisplayColor(options.fill)
      const restoreOpacity = this.beginLocalOpacity(options.fillOpacity)
      ctx.fill(options.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
      if (restoreOpacity) ctx.restore()
    }
    if (options?.stroke) {
      this.recordPrintPaint(options.stroke, true)
      const adjusted = this.adjustedRect(cx - rx, cy - ry, rx * 2, ry * 2, options.strokeWidth ?? 1)
      ctx.beginPath()
      ctx.ellipse(adjusted[0] + adjusted[2] / 2, adjusted[1] + adjusted[3] / 2, adjusted[2] / 2, adjusted[3] / 2, 0, 0, Math.PI * 2)
      ctx.strokeStyle = toDisplayColor(options.stroke)
      this.applyShapeStrokeStyle(options)
      const restoreOpacity = this.beginLocalOpacity(options.strokeOpacity)
      ctx.stroke()
      if (restoreOpacity) ctx.restore()
    }
  }

  drawPath(
    commands: Uint8Array, coords: Float32Array,
    options?: ShapeDrawOptions,
  ): void {
    const ctx = this.ctx
    if (options?.fill) {
      this.recordPrintPaint(options.fill, false)
      this.buildPath(commands, coords)
      ctx.fillStyle = toDisplayColor(options.fill)
      const restoreOpacity = this.beginLocalOpacity(options.fillOpacity)
      ctx.fill(options.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
      if (restoreOpacity) ctx.restore()
    }
    if (options?.stroke) {
      this.recordPrintPaint(options.stroke, true)
      this.buildPath(commands, coords, options.strokeWidth ?? 1)
      ctx.strokeStyle = toDisplayColor(options.stroke)
      this.applyShapeStrokeStyle(options)
      const restoreOpacity = this.beginLocalOpacity(options.strokeOpacity)
      ctx.stroke()
      if (restoreOpacity) ctx.restore()
    }
  }

  drawPathData(
    d: string,
    transform: [number, number, number, number, number, number],
    options?: ShapeDrawOptions,
  ): boolean {
    if (!d || (!options?.fill && !options?.stroke)) return false
    if (options.stroke && (this.activeDeviceParams()?.strokeAdjustment === true || this.activeDeviceParams()?.flatness !== undefined)) return false

    const g = globalThis as Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Path2DCtor = g.Path2D as ({ new(path?: string): any } | undefined)
    if (!Path2DCtor || typeof this.ctx.transform !== 'function') return false

    let path = this.pathDataCache.get(d)
    if (!path) {
      try {
        path = new Path2DCtor(d)
        this.pathDataCache.set(d, path)
      } catch {
        return false
      }
    }

    const ctx = this.ctx
    ctx.save()
    ctx.transform(transform[0], transform[1], transform[2], transform[3], transform[4], transform[5])
    try {
      if (options.fill) {
        this.recordPrintPaint(options.fill, false)
        ctx.fillStyle = toDisplayColor(options.fill)
        const restoreOpacity = this.beginLocalOpacity(options.fillOpacity)
        ctx.fill(path, options.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
        if (restoreOpacity) ctx.restore()
      }
      if (options.stroke) {
        this.recordPrintPaint(options.stroke, true)
        ctx.strokeStyle = toDisplayColor(options.stroke)
        this.applyShapeStrokeStyle(options)
        const restoreOpacity = this.beginLocalOpacity(options.strokeOpacity)
        ctx.stroke(path)
        if (restoreOpacity) ctx.restore()
      }
    } finally {
      ctx.restore()
    }
    return true
  }

  drawPathWithPaints(
    commands: Uint8Array, coords: Float32Array,
    options: PathPaintOptions,
  ): void {
    const ctx = this.ctx
    if (isComplexPaint(options.stroke)) {
      this.paintComplexStroke(commands, coords, options.stroke, options)
      if (options.fill !== undefined) this.drawPathWithPaints(commands, coords, { ...options, stroke: undefined })
      return
    }
    const fill = options.fill
    if (fill !== undefined && typeof fill !== 'string' && (fill.type === 'mesh-gradient' || fill.type === 'tiling-pattern' || fill.type === 'function-shading')) {
      // Clip to the path and paint the shared deterministic content
      ctx.save()
      this.buildPath(commands, coords)
      ctx.clip(options.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
      const restoreOpacity = this.beginLocalOpacity(options.fillOpacity)
      if (fill.type === 'mesh-gradient') this.paintMeshFill(fill)
      else if (fill.type === 'function-shading') this.paintTessellated(tessellateFunctionShading(fill, this.shadingTessellationOptions()))
      else this.paintTilingFill(fill, pathCoordsBounds(coords))
      if (restoreOpacity) ctx.restore()
      ctx.restore()
      if (options.stroke) {
        this.drawPathWithPaints(commands, coords, { ...options, fill: undefined })
      }
      return
    }
    if (fill) {
      this.buildPath(commands, coords)
      const fillStyle = this.resolveCanvasPaint(fill as string | PdfSpecialColorDef | GradientPaint, false)
      if (fillStyle) {
        ctx.fillStyle = fillStyle
        const restoreOpacity = this.beginLocalOpacity(options.fillOpacity)
        ctx.fill(options.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
        if (restoreOpacity) ctx.restore()
      }
    }

    if (options.stroke) {
      this.buildPath(commands, coords, options.strokeWidth ?? 1)
      const strokeStyle = this.resolveCanvasPaint(options.stroke as string | PdfSpecialColorDef | GradientPaint, true)
      if (strokeStyle) {
        ctx.strokeStyle = strokeStyle
        this.applyShapeStrokeStyle(options)
        const restoreOpacity = this.beginLocalOpacity(options.strokeOpacity)
        ctx.stroke()
        if (restoreOpacity) ctx.restore()
      }
    }
  }

  private paintComplexStroke(
    commands: Uint8Array,
    coords: Float32Array,
    paint: MeshGradientPaint | TilingPatternPaint | FunctionShadingPaint,
    options: PathPaintOptions,
  ): void {
    const target = this.ctx
    const layer = this.createLayer()
    this.ctx = layer.ctx
    try {
      if (paint.type === 'mesh-gradient') this.paintMeshFill(paint)
      else if (paint.type === 'function-shading') this.paintTessellated(tessellateFunctionShading(paint, this.shadingTessellationOptions()))
      else this.paintTilingFill(paint, pathStrokeBounds(coords, options.strokeWidth ?? 1, options.strokeMiterLimit ?? 10))
      const ctx = this.ctx
      ctx.save()
      ctx.globalCompositeOperation = 'destination-in'
      this.buildPath(commands, coords, options.strokeWidth ?? 1)
      ctx.strokeStyle = '#000000'
      this.applyShapeStrokeStyle(options)
      ctx.stroke()
      ctx.restore()
    } finally {
      this.ctx = target
    }
    target.save()
    target.setTransform(1, 0, 0, 1, 0, 0)
    target.globalAlpha = clamp01(options.strokeOpacity ?? 1)
    target.drawImage(layer.canvas, 0, 0)
    target.restore()
  }

  private paintMeshFill(paint: MeshGradientPaint): void {
    const options = this.shadingTessellationOptions()
    const ordinaryPatchCount = paint.patches.length
    const packedPatchCount = paint.packedPatches === undefined ? 0 : Math.floor(paint.packedPatches.points.length / 32)
    const rasterizePatches = ordinaryPatchCount + packedPatchCount >= 64
    if (rasterizePatches) {
      this.paintPackedMeshRaster({ ...paint, patches: [], packedPatches: packMeshPatches(paint) })
    } else if (paint.packedPatches !== undefined) {
      forEachPackedMeshCell(paint, (cell) => this.paintPackedMeshCell(cell), options?.bounds)
    }
    if ((!rasterizePatches && paint.patches.length > 0) || paint.triangles.length > 0 || paint.packedTriangles !== undefined || paint.lattice !== undefined) {
      this.paintTessellated(tessellateMeshGradient({
        ...paint,
        patches: rasterizePatches ? [] : paint.patches,
        packedPatches: undefined,
      }, options))
    }
  }

  private paintPackedMeshRaster(paint: MeshGradientPaint): void {
    const ctx = this.ctx
    if (typeof ctx.getTransform !== 'function') throw new Error('Canvas backend requires getTransform to rasterize a mesh shading')
    const raster = rasterizePackedMesh(paint, ctx.getTransform(), ctx.canvas.width, ctx.canvas.height)
    if (raster === null) return
    const canvas = createDeviceCanvas(ctx.canvas, raster.width, raster.height)
    const rasterContext = canvas.getContext('2d')
    if (rasterContext === null) throw new Error('Canvas backend could not create a 2D context for a mesh shading')
    const image = rasterContext.createImageData(raster.width, raster.height)
    image.data.set(raster.data)
    rasterContext.putImageData(image, 0, 0)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(canvas, raster.x, raster.y)
    ctx.restore()
  }

  private paintPackedMeshCell(cell: PackedMeshFillCell): void {
    const ctx = this.ctx
    const p = inflateMeshCell(cell.points)
    const horizontalStart = averagePackedColor(cell.colors[0], cell.colors[1])
    const horizontalEnd = averagePackedColor(cell.colors[3], cell.colors[2])
    const verticalStart = averagePackedColor(cell.colors[0], cell.colors[3])
    const verticalEnd = averagePackedColor(cell.colors[1], cell.colors[2])
    const horizontalSpan = packedColorDistance(horizontalStart, horizontalEnd)
    const verticalSpan = packedColorDistance(verticalStart, verticalEnd)
    let gradient
    if (horizontalSpan >= verticalSpan) {
      gradient = ctx.createLinearGradient((p[0] + p[2]) / 2, (p[1] + p[3]) / 2, (p[6] + p[4]) / 2, (p[7] + p[5]) / 2)
      gradient.addColorStop(0, packedCanvasColor(horizontalStart))
      gradient.addColorStop(1, packedCanvasColor(horizontalEnd))
    } else {
      gradient = ctx.createLinearGradient((p[0] + p[6]) / 2, (p[1] + p[7]) / 2, (p[2] + p[4]) / 2, (p[3] + p[5]) / 2)
      gradient.addColorStop(0, packedCanvasColor(verticalStart))
      gradient.addColorStop(1, packedCanvasColor(verticalEnd))
    }
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    ctx.lineTo(p[2], p[3])
    ctx.lineTo(p[4], p[5])
    ctx.lineTo(p[6], p[7])
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()
  }

  private paintTessellated(triangles: ReturnType<typeof tessellateMeshGradient>): void {
    const ctx = this.ctx
    for (let i = 0; i < triangles.length; i++) {
      const t = triangles[i]!
      ctx.beginPath()
      ctx.moveTo(t.points[0], t.points[1])
      ctx.lineTo(t.points[2], t.points[3])
      ctx.lineTo(t.points[4], t.points[5])
      ctx.closePath()
      ctx.fillStyle = t.color
      ctx.fill()
    }
  }

  private paintTilingFill(paint: TilingPatternPaint, bounds: [number, number, number, number]): void {
    const ctx = this.ctx
    const range = tileIndexRange(paint, bounds)
    const cellCount = (range.i1 - range.i0 + 1) * (range.j1 - range.j0 + 1)
    if (cellCount > 65536) {
      throw new Error(`Tiling pattern produces ${cellCount} cells for one fill; the steps are degenerate`)
    }
    ctx.save()
    const m = paint.matrix
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
    const [bx0, by0, bx1, by1] = paint.bbox
    for (let i = range.i0; i <= range.i1; i++) {
      for (let j = range.j0; j <= range.j1; j++) {
        ctx.save()
        ctx.translate(i * paint.xStep, j * paint.yStep)
        ctx.beginPath()
        ctx.rect(bx0, by0, bx1 - bx0, by1 - by0)
        ctx.clip()
        this.paintTileGraphics(paint)
        ctx.restore()
      }
    }
    ctx.restore()
  }

  private paintTileGraphics(paint: TilingPatternPaint): void {
    for (let g = 0; g < paint.graphics.length; g++) this.paintTileGraphic(paint.graphics[g]!, paint)
  }

  private paintTileGraphic(graphic: TileGraphic, paint: TilingPatternPaint): void {
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
        this.paintTileGroup(graphic, paint)
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

  private paintTileGroup(group: TileGroupGraphic, paint: TilingPatternPaint): void {
    if (group.optionalContent?.visible === false) return
    this.save()
    this.translate(group.x, group.y)
    if (group.affineTransform !== undefined) this.transform(...group.affineTransform)
    if (group.clipPath !== undefined) this.clipPath(group.clipPath.commands, group.clipPath.coords, group.clipPath.fillRule)
    if (group.blendMode !== undefined) this.setBlendMode(group.blendMode)
    if (group.alphaIsShape !== undefined || group.textKnockout !== undefined) {
      this.setTransparencyParameters(group.alphaIsShape, group.textKnockout)
    }
    if (group.deviceParams !== undefined) this.beginDeviceParams(group.deviceParams)
    const transparency = group.transparencyGroup === true || group.isolated === true || group.knockout === true || group.softMask !== undefined || (group.opacity !== undefined && group.opacity < 1)
    if (transparency) {
      if (group.softMask !== undefined) {
        this.beginSoftMask(group.softMask.type, group.width, group.height, group.softMask.backdrop, group.softMask.transferFunction)
        for (let i = 0; i < group.softMask.graphics.length; i++) this.paintTileGraphic(group.softMask.graphics[i]!, paint)
        this.endSoftMask()
      }
      this.beginTransparencyGroup(group.width, group.height, { isolated: group.isolated === true, knockout: group.knockout === true, opacity: group.opacity, hasSoftMask: group.softMask !== undefined })
    } else if (group.opacity !== undefined && group.opacity < 1) this.setOpacity(group.opacity)
    for (let i = 0; i < group.graphics.length; i++) this.paintTileGraphic(group.graphics[i]!, paint)
    if (transparency) this.endTransparencyGroup()
    if (group.deviceParams !== undefined) this.endDeviceParams()
    this.restore()
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
      // The cache is shared across backend instances, so the key must be
      // content-based: the URL itself.
      if (!this.tryDrawUrlImage(resolved.url, resolved.url, x, y, width, height, options)) {
        this.drawImagePlaceholder(x, y, width, height)
      }
      return
    }
    if (resolved.kind === 'svg') {
      // SVG images are always drawn as vectors
      const svgDoc = parseSvg(resolved.data)
      renderSvg(svgDoc, this, x, y, width, height)
      return
    }
    const mimeType = rasterMimeType(resolved.format)
    // Content-based cache key (hashed once per imageId per backend instance).
    let contentKey = this.imageContentKeys.get(imageId)
    if (!contentKey) {
      contentKey = `raster_${hashBytesFNV1a(resolved.data)}_${resolved.data.length}`
      this.imageContentKeys.set(imageId, contentKey)
    }
    if (!this.tryDrawRasterImage(contentKey, resolved.data, mimeType, x, y, width, height, options)) {
      this.drawImagePlaceholder(x, y, width, height)
    }
  }

  drawSvg(x: number, y: number, width: number, height: number, svgData: string): void {
    const svgDoc = parseSvg(svgData)
    renderSvg(svgDoc, this, x, y, width, height)
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
    const ctx = this.ctx
    ctx.save()
    ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f)
    this.drawImage(0, 0, 1, 1, imageId, options)
    ctx.restore()
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

  /**
   * Starts loading an image element for the given source, or returns the
   * cached entry. Load completion notifies every backend that hit the entry
   * while it was loading, so owners re-render with the image available.
   */
  private loadImageEntry(cacheKey: string, src: string, imageCtor: { new(): unknown }): RasterImageCacheEntry {
    let entry = this.rasterImageCache.get(cacheKey)
    if (entry) return entry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const img = new imageCtor() as any
    entry = { image: img, state: 'loading', readyObservers: new Set() }
    this.rasterImageCache.set(cacheKey, entry)

    img.onload = () => {
      const current = this.rasterImageCache.get(cacheKey)
      if (!current) return
      current.state = 'ready'
      const observers = current.readyObservers
      current.readyObservers = new Set()
      for (const observer of observers) observer.rasterImageSettled()
    }
    img.onerror = () => {
      const current = this.rasterImageCache.get(cacheKey)
      if (!current) return
      current.state = 'error'
      const observers = current.readyObservers
      current.readyObservers = new Set()
      for (const observer of observers) observer.rasterImageSettled()
    }
    img.src = src
    if (img.complete) entry.state = 'ready'
    return entry
  }

  private tryDrawRasterImage(
    cacheKey: string,
    data: Uint8Array,
    mimeType: string,
    x: number, y: number, width: number, height: number,
    options?: ImageDrawOptions,
  ): boolean {
    const g = globalThis as Record<string, unknown>
    const btoaFn = g.btoa as ((s: string) => string) | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ImageCtor = g.Image as ({ new(): any } | undefined)
    if (!ImageCtor || !btoaFn) return false

    let entry = this.rasterImageCache.get(cacheKey)
    if (!entry) {
      entry = this.loadImageEntry(cacheKey, bytesToDataUri(data, mimeType, btoaFn), ImageCtor)
    }
    return this.drawCachedImage(entry, x, y, width, height, options)
  }

  private tryDrawUrlImage(
    cacheKey: string,
    url: string,
    x: number, y: number, width: number, height: number,
    options?: ImageDrawOptions,
  ): boolean {
    const g = globalThis as Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ImageCtor = g.Image as ({ new(): any } | undefined)
    if (!ImageCtor) return false

    let entry = this.rasterImageCache.get(cacheKey)
    if (!entry) {
      entry = this.loadImageEntry(cacheKey, url, ImageCtor)
    }
    return this.drawCachedImage(entry, x, y, width, height, options)
  }

  /**
   * Draws a cached image when ready. A still-loading image is not painted —
   * painting it later would lose the active clip and stacking order — the
   * owner is instead asked to re-render once it is ready (onImagesReady).
   */
  private drawCachedImage(entry: RasterImageCacheEntry, x: number, y: number, width: number, height: number, options?: ImageDrawOptions): boolean {
    if (entry.state === 'ready') {
      if ('imageSmoothingEnabled' in this.ctx) this.ctx.imageSmoothingEnabled = options?.interpolate !== false
      this.ctx.drawImage(entry.image, x, y, width, height)
      return true
    }
    if (entry.state === 'loading') {
      if (this.onImagesReady) {
        this.pendingRasterImages.add(entry)
        entry.readyObservers.add(this)
      }
      return true
    }
    return false
  }

  /** Notifies the owner once after every raster image encountered by this pass has settled. */
  rasterImageSettled(): void {
    for (const entry of this.pendingRasterImages) {
      if (entry.state === 'loading') return
    }
    this.pendingRasterImages.clear()
    const callback = this.onImagesReady
    this.onImagesReady = undefined
    if (callback !== undefined) callback()
  }

  private applyShapeStrokeStyle(options: ShapeDrawOptions | PathPaintOptions): void {
    const ctx = this.ctx
    ctx.lineWidth = this.canvasStrokeWidth(options.strokeWidth ?? 1)
    ctx.lineCap = options.strokeLinecap ?? 'butt'
    ctx.lineJoin = options.strokeLinejoin ?? 'miter'
    ctx.miterLimit = options.strokeMiterLimit ?? 10
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash(options.strokeDasharray && options.strokeDasharray.length > 0 ? options.strokeDasharray : [])
    }
    ctx.lineDashOffset = options.strokeDashoffset ?? 0
  }

  private canvasStrokeWidth(width: number): number {
    if (width === 0) return 1 / (this.scale * this.dpr)
    return this.activeDeviceParams()?.strokeAdjustment === true
      ? adjustPdfStrokeWidth(width, this.deviceTransform())
      : width
  }

  private deviceTransform(): { a: number, b: number, c: number, d: number, e: number, f: number } {
    if (typeof this.ctx.getTransform !== 'function') {
      throw new Error('Canvas stroke adjustment requires getTransform')
    }
    return this.ctx.getTransform()
  }

  private adjustedRect(x: number, y: number, width: number, height: number, strokeWidth: number): [number, number, number, number] {
    if (this.activeDeviceParams()?.strokeAdjustment !== true) return [x, y, width, height]
    const adjusted = adjustPdfStrokePath(
      new Float32Array([x, y, x + width, y + height]),
      strokeWidth,
      this.deviceTransform(),
    )
    return [adjusted[0]!, adjusted[1]!, adjusted[2]! - adjusted[0]!, adjusted[3]! - adjusted[1]!]
  }

  private buildRectPath(
    x: number,
    y: number,
    width: number,
    height: number,
    radii: ResolvedRectCornerRadii | undefined,
    hasRoundedCorners: boolean,
  ): void {
    const ctx = this.ctx
    ctx.beginPath()
    if (hasRoundedCorners && typeof ctx.roundRect === 'function') {
      const resolved = radii!
      if (
        resolved.topLeft === resolved.topRight
        && resolved.topLeft === resolved.bottomRight
        && resolved.topLeft === resolved.bottomLeft
      ) ctx.roundRect(x, y, width, height, resolved.topLeft)
      else ctx.roundRect(x, y, width, height, [resolved.topLeft, resolved.topRight, resolved.bottomRight, resolved.bottomLeft])
    } else if (hasRoundedCorners) drawRoundedRectPath(ctx, x, y, width, height, radii!)
    else ctx.rect(x, y, width, height)
  }

  private activeDeviceParams(): RenderDeviceParams | undefined {
    for (let i = this.layerStack.length - 1; i >= 0; i--) {
      if (this.layerStack[i]!.kind === 'device') return this.layerStack[i]!.deviceParams
    }
    return undefined
  }

  private activeTransparencyGroup(): CanvasLayerFrame | undefined {
    for (let i = this.layerStack.length - 1; i >= 0; i--) {
      const frame = this.layerStack[i]!
      if (frame.kind === 'group') return frame
      if (frame.kind === 'device' && frame.deviceRaster === false) continue
      if (frame.kind !== 'object') return undefined
    }
    return undefined
  }

  private activeTransparencyObject(): CanvasLayerFrame | undefined {
    const frame = this.layerStack[this.layerStack.length - 1]
    return frame?.kind === 'object' ? frame : undefined
  }

  private layerForContext(ctx: any): CanvasLayer {
    for (let i = this.layerStack.length - 1; i >= 0; i--) {
      const layer = this.layerStack[i]!.layer
      if (layer.ctx === ctx) return layer
    }
    return { canvas: ctx.canvas, ctx, originX: 0, originY: 0 }
  }

  private activeOverprintObject(): CanvasLayerFrame | undefined {
    for (let i = this.layerStack.length - 1; i >= 0; i--) {
      if (this.layerStack[i]!.kind === 'overprint') return this.layerStack[i]
    }
    return undefined
  }

  private shadingTessellationOptions(): { smoothness?: number, bounds?: [number, number, number, number] } | undefined {
    const smoothness = this.activeDeviceParams()?.smoothness
    const bounds = this.visiblePaintBounds()
    return smoothness === undefined && bounds === undefined ? undefined : { smoothness, bounds }
  }

  private visiblePaintBounds(): [number, number, number, number] | undefined {
    const ctx = this.ctx
    if (this.viewport === undefined || typeof ctx.getTransform !== 'function') return undefined
    const matrix = ctx.getTransform()
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return undefined
    const inversePoint = function (x: number, y: number): [number, number] {
      const tx = x - matrix.e
      const ty = y - matrix.f
      return [
        (matrix.d * tx - matrix.c * ty) / determinant,
        (-matrix.b * tx + matrix.a * ty) / determinant,
      ]
    }
    const width = ctx.canvas.width
    const height = ctx.canvas.height
    const p0 = inversePoint(0, 0)
    const p1 = inversePoint(width, 0)
    const p2 = inversePoint(0, height)
    const p3 = inversePoint(width, height)
    return [
      Math.min(p0[0], p1[0], p2[0], p3[0]),
      Math.min(p0[1], p1[1], p2[1], p3[1]),
      Math.max(p0[0], p1[0], p2[0], p3[0]),
      Math.max(p0[1], p1[1], p2[1], p3[1]),
    ]
  }

  private buildPath(commands: Uint8Array, coords: Float32Array, strokeWidth?: number): void {
    const ctx = this.ctx
    const flatness = this.activeDeviceParams()?.flatness
    if (flatness !== undefined && flatness > 0) {
      const flattened = flattenPdfPath(commands, coords, flatness / (this.scale * this.dpr))
      commands = flattened.commands
      coords = flattened.coords
    }
    if (strokeWidth !== undefined && this.activeDeviceParams()?.strokeAdjustment === true) {
      coords = adjustPdfStrokePath(coords, strokeWidth, this.deviceTransform())
    }
    ctx.beginPath()
    let ci = 0

    for (let i = 0; i < commands.length; i++) {
      switch (commands[i]) {
        case 0: // MoveTo
          ctx.moveTo(coords[ci]!, coords[ci + 1]!)
          ci += 2
          break
        case 1: // LineTo
          ctx.lineTo(coords[ci]!, coords[ci + 1]!)
          ci += 2
          break
        case 2: // CubicTo
          ctx.bezierCurveTo(
            coords[ci]!, coords[ci + 1]!,
            coords[ci + 2]!, coords[ci + 3]!,
            coords[ci + 4]!, coords[ci + 5]!,
          )
          ci += 6
          break
        case 3: // Close
          ctx.closePath()
          break
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveCanvasPaint(paint: string | PdfSpecialColorDef | GradientPaint, stroke = false): string | any | null {
    if (typeof paint === 'string') {
      this.recordPrintPaint(paint, stroke)
      return toDisplayColor(paint)
    }
    if (paint.type === 'pdfSpecialColor') {
      this.recordPrintPaint(paint, stroke)
      return paint.displayColor
    }
    return this.createCanvasGradient(paint)
  }

  private recordPrintPaint(paint: string | PdfSpecialColorDef, stroke: boolean): void {
    const frame = this.activeOverprintObject()
    if (frame !== undefined) frame.printPaints!.push({ color: resolvePdfPrintColor(paint, this.printColorTransform), stroke })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createCanvasGradient(paint: GradientPaint): any | null {
    const ctx = this.ctx
    if (paint.type === 'linear-gradient') {
      if (typeof ctx.createLinearGradient !== 'function') return null
      const spread = paint.spreadMethod ?? 'pad'
      let x1 = paint.x1
      let y1 = paint.y1
      let x2 = paint.x2
      let y2 = paint.y2
      let stops = this.normalizeGradientStops(paint.stops)
      if ((spread === 'repeat' || spread === 'reflect') && stops.length >= 2) {
        const mode: ExtendMode = spread === 'repeat' ? 1 : 2
        const N = 64
        stops = extendGradientStopsCanvas(stops, mode, N)
        const dx = x2 - x1
        const dy = y2 - y1
        x1 -= N * dx
        y1 -= N * dy
        x2 += N * dx
        y2 += N * dy
      }
      const g = ctx.createLinearGradient(x1, y1, x2, y2)
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i]!
        g.addColorStop(s.offset, colorWithOpacity(s.color, s.opacity))
      }
      return g
    }

    if (typeof ctx.createRadialGradient !== 'function') return null
    const spread = paint.spreadMethod ?? 'pad'
    let fx = paint.fx ?? paint.cx
    let fy = paint.fy ?? paint.cy
    let fr = paint.fr ?? 0
    let cx = paint.cx
    let cy = paint.cy
    let r = paint.r
    let stops = this.normalizeGradientStops(paint.stops)
    if ((spread === 'repeat' || spread === 'reflect') && stops.length >= 2) {
      const mode: ExtendMode = spread === 'repeat' ? 1 : 2
      const N = 64
      stops = extendGradientStopsCanvas(stops, mode, N)
      const dx = cx - fx
      const dy = cy - fy
      const dr = r - fr
      fx -= N * dx
      fy -= N * dy
      fr = Math.max(0, fr - N * dr)
      cx += N * dx
      cy += N * dy
      r = Math.max(0, r + N * dr)
    }

    const g = ctx.createRadialGradient(fx, fy, fr, cx, cy, r)
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]!
      g.addColorStop(s.offset, colorWithOpacity(s.color, s.opacity))
    }
    return g
  }

  private normalizeGradientStops(stops: GradientStop[]): GradientStop[] {
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

  private beginLocalOpacity(opacity: number | undefined): boolean {
    const o = opacity == null ? 1 : clamp01(opacity)
    if (o >= 1) return false
    const ctx = this.ctx
    const base = typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : 1
    ctx.save()
    ctx.globalAlpha = base * o
    return true
  }

  private drawImagePlaceholder(x: number, y: number, width: number, height: number): void {
    const ctx = this.ctx
    ctx.strokeStyle = '#CCCCCC'
    ctx.lineWidth = 0.5
    ctx.strokeRect(x, y, width, height)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + width, y + height)
    ctx.moveTo(x + width, y)
    ctx.lineTo(x, y + height)
    ctx.stroke()
  }

  setImages(images: Record<string, string | Uint8Array>): void {
    this.imageResources.setDocumentImages(images)
    this.imageContentKeys.clear()
  }

  private get images(): Record<string, string | Uint8Array> {
    return this.imageResources.images
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

    const ctx = this.ctx
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

    // Effective raster pixels per em (also selects bitmap glyph strikes)
    const rasterPpem = fontSize * this.scale * this.dpr
    const hintPpem = this.hinting ? Math.round(rasterPpem) : 0
    const hintHorizontalPpem = this.hinting ? Math.max(1, Math.round(rasterPpem * horizontalScale)) : 0

    const hasOutlines = font.hasScalableOutlines
    const hasColrGlyphs = font.hasColrGlyphs
    const hasSvgGlyphs = font.hasSvgGlyphs
    const hasEmbeddedBitmapGlyphs = font.hasEmbeddedBitmapGlyphs
    let textExtent = 0
    if (run) {
      for (let gi = 0; gi < run.advances.length; gi++) textExtent += run.advances[gi]!
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
        const aw = font.getAdvanceWidth(gid) * s
        const deviceAdvance = hintPpem > 0
          ? font.getDeviceMetrics(gid, hintHorizontalPpem, hintPpem).advanceWidthPixels / (this.scale * this.dpr)
          : aw * horizontalScale
        const advance = isVertical ? font.getAdvanceHeight(gid) * s : deviceAdvance + letterSpacing * horizontalScale
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
    // Font coordinates: Y-up → Canvas: Y-down (flipped)
    // Draw each glyph as a separate path (prevents winding interference between subpaths)
    const baseY = y + (options?.baselineOffset ?? ascent)

    let cx = drawX
    let cy = baseY
    let textIndex = 0
    let gi = 0
    const glyphCount = run?.glyphIds.length ?? Number.MAX_SAFE_INTEGER
    while (run ? gi < glyphCount : textIndex < text.length) {
      let gid: number
      let advance: number
      let advanceWidth: number
      let xOffset: number
      let yOffset: number
      let xScale: number
      let yScale: number
      let rotation: 0 | 90
      if (run) {
        gid = run.glyphIds[gi]!
        advance = run.advances[gi]!
        advanceWidth = isVertical ? font.getAdvanceWidth(gid) * s : 0
        xOffset = run.xOffsets[gi]!
        yOffset = run.yOffsets[gi]!
        xScale = run.xScales?.[gi] ?? 1
        yScale = run.yScales?.[gi] ?? 1
        rotation = run.rotations?.[gi] === 90 ? 90 : 0
      } else {
        let cp = text.charCodeAt(textIndex++)
        if (cp >= 0xD800 && cp <= 0xDBFF && textIndex < text.length) {
          const lo = text.charCodeAt(textIndex)
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            cp = ((cp - 0xD800) << 10) + (lo - 0xDC00) + 0x10000
            textIndex++
          }
        }
        gid = presetGlyphIds && gi < presetGlyphIds.length ? presetGlyphIds[gi]! : font.getGlyphId(cp)
        advanceWidth = font.getAdvanceWidth(gid) * s
        const deviceAdvance = hintPpem > 0
          ? font.getDeviceMetrics(gid, hintHorizontalPpem, hintPpem).advanceWidthPixels / (this.scale * this.dpr)
          : advanceWidth * horizontalScale
        advance = isVertical ? font.getAdvanceHeight(gid) * s : deviceAdvance + letterSpacing * horizontalScale
        xOffset = 0
        yOffset = 0
        xScale = 1
        yScale = 1
        rotation = 0
      }

      const override = run?.outlineOverrides?.[gi] ?? null
      const glyph = override === null && hasOutlines
        ? (hintPpem > 0 ? font.getHintedGlyph(gid, hintPpem, hintHorizontalPpem) : font.getGlyph(gid))
        : null
      const commands = override?.commands ?? glyph?.outline.commands ?? EMPTY_GLYPH_COMMANDS
      const coords = override?.coords ?? glyph?.outline.coords ?? EMPTY_GLYPH_COORDS

      // Compute glyph origin adjustment for vertical writing
      let glyphCx = cx
      let glyphCy = cy
      if (isVertical) {
        const halfAw = advanceWidth / 2
        const vOriginY = font.getVerticalOrigin(gid) * s
        glyphCx = cx + fontSize / 2 - halfAw + xOffset
        glyphCy = cy - ascent + vOriginY - yOffset
      } else {
        // Apply GPOS placement offsets (mark positioning etc.)
        glyphCx = cx + xOffset
        glyphCy = cy - yOffset
      }

      const mergeGroup = run?.mergeGroups?.[gi] ?? 0
      if (mergeGroup !== 0) {
        const mergeRun = run!
        const outlines: PositionedGlyphOutline[] = []
        let groupCx = cx
        let groupCy = cy
        let end = gi
        while (end < mergeRun.glyphIds.length && mergeRun.mergeGroups![end] === mergeGroup) {
          const memberGid = mergeRun.glyphIds[end]!
          const memberAdvanceWidth = font.getAdvanceWidth(memberGid) * s
          const memberXOffset = mergeRun.xOffsets[end]!
          const memberYOffset = mergeRun.yOffsets[end]!
          const memberOverride = mergeRun.outlineOverrides?.[end] ?? null
          const memberGlyph = memberOverride === null && hasOutlines
            ? (hintPpem > 0 ? font.getHintedGlyph(memberGid, hintPpem, hintHorizontalPpem) : font.getGlyph(memberGid))
            : null
          let originX = groupCx + memberXOffset
          let originY = groupCy - memberYOffset
          if (isVertical) {
            originX = groupCx + fontSize / 2 - memberAdvanceWidth / 2 + memberXOffset
            originY = groupCy - ascent + font.getVerticalOrigin(memberGid) * s - memberYOffset
          }
          outlines.push({
            outline: {
              commands: memberOverride?.commands ?? memberGlyph?.outline.commands ?? EMPTY_GLYPH_COMMANDS,
              coords: memberOverride?.coords ?? memberGlyph?.outline.coords ?? EMPTY_GLYPH_COORDS,
            },
            originX,
            originY,
            xScale: mergeRun.xScales?.[end] ?? 1,
            yScale: mergeRun.yScales?.[end] ?? 1,
            rotation: mergeRun.rotations?.[end] === 90 ? 90 : 0,
          })
          if (isVertical) groupCy += mergeRun.advances[end]!
          else groupCx += mergeRun.advances[end]!
          end++
        }
        const merged = mergePositionedGlyphOutlines(outlines, s, horizontalScale, slant)
        this.drawGlyphOutline(ctx, merged.commands, merged.coords, 0, 0, 1, 1, color, 0, boldWidth, textPaintMode, textStrokeColor, textStrokeWidth)
        cx = groupCx
        cy = groupCy
        gi = end
        continue
      }

      if (xScale !== 1 || yScale !== 1 || rotation === 90) {
        ctx.save()
        ctx.translate(glyphCx, glyphCy)
        if (rotation === 90) ctx.transform(0, 1, -1, 0, 0, 0)
        ctx.scale(xScale, yScale)
        ctx.translate(-glyphCx, -glyphCy)
      }

      // COLR v1 check
      const hasOutlineOverride = run?.outlineOverrides?.[gi] != null
      const paintTree = hasOutlineOverride || nonFillTextPaint || !hasColrGlyphs ? null : font.getPaintTree(gid)
      if (paintTree) {
        const fg = parseForegroundColor(color)
        const colrOps = createCanvasColrV1Ops(ctx, font)
        renderColrV1Glyph(font, gid, colrOps, s, glyphCx, glyphCy, fg)
      } else {
        // Color layer check (COLR v0)
        const colorLayers = hasOutlineOverride || nonFillTextPaint || !hasColrGlyphs ? null : font.getColorLayers(gid)
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
            this.drawGlyphOutline(ctx, layerGlyph.outline.commands, layerGlyph.outline.coords, glyphCx, glyphCy, s, horizontalScale, layerColor, slant, boldWidth, textPaintMode, textStrokeColor, textStrokeWidth)
          }
        } else if (hasOutlineOverride || nonFillTextPaint
          || ((!hasSvgGlyphs && !hasEmbeddedBitmapGlyphs)
            || !this.drawSvgOrBitmapGlyph(font, gid, glyphCx, glyphCy, fontSize, s, rasterPpem, color, horizontalScale, isVertical))) {
          // Regular monochrome drawing
          const rasterized = !hasOutlineOverride && !nonFillTextPaint && hintPpem > 0 && !slant && !boldWidth
            && this.drawTrueTypeDropoutGlyph(
              ctx, font, gid, hintPpem, hintHorizontalPpem,
              glyphCx, glyphCy, color, rotation === 90,
            )
          if (!rasterized) this.drawGlyphOutline(ctx, commands, coords, glyphCx, glyphCy, s, horizontalScale, color, slant, boldWidth, textPaintMode, textStrokeColor, textStrokeWidth)
        }
      }
      if (xScale !== 1 || yScale !== 1 || rotation === 90) ctx.restore()
      if (isVertical) {
        cy += advance
      } else {
        cx += advance
      }
      gi++
    }

    // Underline (horizontal writing only)
    if (options?.underline && !isVertical) {
      const ulPos = m.underlinePosition * s
      const ulThick = Math.max(m.underlineThickness * s, 0.5)
      const lineY = baseY - ulPos
      ctx.beginPath()
      ctx.moveTo(drawX, lineY)
      ctx.lineTo(drawX + textExtent, lineY)
      ctx.strokeStyle = color
      ctx.lineWidth = ulThick
      ctx.stroke()
    }

    // Strikethrough (horizontal writing only)
    if (options?.strikethrough && !isVertical) {
      const strikeY = baseY - m.strikeoutPosition * s
      const strikeThick = Math.max(m.strikeoutSize * s, 0.5)
      ctx.beginPath()
      ctx.moveTo(drawX, strikeY)
      ctx.lineTo(drawX + textExtent, strikeY)
      ctx.strokeStyle = color
      ctx.lineWidth = strikeThick
      ctx.stroke()
    }

    // Reset Variable Font axis values
    if (options?.variation) {
      font.setVariation({})
    }
  }

  /**
   * Draws an OT-SVG or embedded bitmap glyph following the color font
   * priority order (COLR handled by the caller): SVG → sbix/CBDT/EBDT.
   * @returns true when the glyph was drawn
   */
  private drawSvgOrBitmapGlyph(
    font: Font, gid: number,
    glyphCx: number, glyphCy: number,
    fontSize: number, s: number, ppem: number, color: string, horizontalScale: number, vertical: boolean,
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
    const bitmap = prepareBitmapGlyph(font, gid, fontSize, ppem, color, ppem * horizontalScale, horizontalScale, vertical)
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

  /** Draws the specification-defined monochrome dropout bitmap when enabled by the glyph program. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private drawTrueTypeDropoutGlyph(
    ctx: any,
    font: Font,
    glyphId: number,
    ppem: number,
    horizontalPpem: number,
    originX: number,
    baselineY: number,
    color: string,
    rotated: boolean,
  ): boolean {
    const bitmap = font.rasterizeTrueTypeGlyph(glyphId, ppem, {
      horizontalPpem,
      rotated,
      stretched: horizontalPpem !== ppem,
    })
    if (bitmap === null || !bitmap.dropoutControl || bitmap.width === 0 || bitmap.height === 0) return false
    const pixelSize = 1 / (this.scale * this.dpr)
    ctx.fillStyle = color
    for (let row = 0; row < bitmap.height; row++) {
      for (let column = 0; column < bitmap.width; column++) {
        if (bitmap.pixels[row * bitmap.width + column] === 0) continue
        ctx.fillRect(
          originX + (bitmap.xMin + column) * pixelSize,
          baselineY - (bitmap.yMin + row + 1) * pixelSize,
          pixelSize,
          pixelSize,
        )
      }
    }
    return true
  }

  /** Draw a glyph outline as a Canvas path */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private drawGlyphOutline(
    ctx: any,
    commands: Uint8Array, coords: Float32Array,
    cx: number, baseY: number, s: number, horizontalScale: number, color: string,
    slant?: number, boldWidth?: number,
    paintMode: 'fill' | 'stroke' | 'fillStroke' = 'fill', strokeColor = color, strokeWidth = 1,
  ): void {
    if (commands.length === 0) return
    ctx.fillStyle = color
    const t = slant || 0
    const Path2DCtor = (globalThis as unknown as { Path2D?: new () => any }).Path2D
    if (paintMode === 'fill' && !boldWidth && Path2DCtor !== undefined && typeof ctx.transform === 'function') {
      let cached = sharedCanvasGlyphPathCache.get(commands)
      if (cached === undefined || cached.coords !== coords || cached.constructor !== Path2DCtor) {
        const path = new Path2DCtor()
        let pathCoordIndex = 0
        for (let i = 0; i < commands.length; i++) {
          switch (commands[i]) {
            case 0:
              path.moveTo(coords[pathCoordIndex]!, coords[pathCoordIndex + 1]!)
              pathCoordIndex += 2
              break
            case 1:
              path.lineTo(coords[pathCoordIndex]!, coords[pathCoordIndex + 1]!)
              pathCoordIndex += 2
              break
            case 2:
              path.bezierCurveTo(
                coords[pathCoordIndex]!, coords[pathCoordIndex + 1]!,
                coords[pathCoordIndex + 2]!, coords[pathCoordIndex + 3]!,
                coords[pathCoordIndex + 4]!, coords[pathCoordIndex + 5]!,
              )
              pathCoordIndex += 6
              break
            case 3:
              path.closePath()
              break
          }
        }
        cached = { coords, constructor: Path2DCtor, path }
        sharedCanvasGlyphPathCache.set(commands, cached)
      }
      ctx.save()
      ctx.transform(s * horizontalScale, 0, t * s * horizontalScale, -s, cx, baseY)
      ctx.fill(cached.path)
      ctx.restore()
      return
    }

    ctx.beginPath()
    let ci = 0
    for (let i = 0; i < commands.length; i++) {
      switch (commands[i]) {
        case 0: { // MoveTo
          const fx = coords[ci]!, fy = coords[ci + 1]!
          ctx.moveTo(cx + (fx + fy * t) * s * horizontalScale, baseY - fy * s)
          ci += 2
          break
        }
        case 1: { // LineTo
          const fx = coords[ci]!, fy = coords[ci + 1]!
          ctx.lineTo(cx + (fx + fy * t) * s * horizontalScale, baseY - fy * s)
          ci += 2
          break
        }
        case 2: { // CubicTo
          const fx1 = coords[ci]!, fy1 = coords[ci + 1]!
          const fx2 = coords[ci + 2]!, fy2 = coords[ci + 3]!
          const fx3 = coords[ci + 4]!, fy3 = coords[ci + 5]!
          ctx.bezierCurveTo(
            cx + (fx1 + fy1 * t) * s * horizontalScale, baseY - fy1 * s,
            cx + (fx2 + fy2 * t) * s * horizontalScale, baseY - fy2 * s,
            cx + (fx3 + fy3 * t) * s * horizontalScale, baseY - fy3 * s,
          )
          ci += 6
          break
        }
        case 3: // Close
          ctx.closePath()
          break
      }
    }
    if (paintMode !== 'stroke') ctx.fill()
    if (paintMode !== 'fill' || boldWidth) {
      ctx.strokeStyle = paintMode === 'fill' ? color : strokeColor
      ctx.lineWidth = paintMode === 'fill' ? boldWidth : strokeWidth
      ctx.lineJoin = 'round'
      ctx.stroke()
    }
  }

  // ─── Text drawing with CSS fonts (fallback) ───

  private drawTextWithCSS(
    x: number, y: number,
    text: string,
    fontId: string, fontSize: number, color: string,
    options?: TextDrawOptions,
  ): void {
    const ctx = this.ctx

    const font = `${options?.italic ? 'italic ' : ''}${options?.bold ? 'bold ' : ''}${fontSize}px ${fontId}`
    if (ctx.font !== font) ctx.font = font
    ctx.fillStyle = color
    const textPaintMode = options?.textPaintMode ?? 'fill'
    if (textPaintMode !== 'fill') {
      ctx.strokeStyle = toDisplayColor(options?.textStrokeColor ?? color)
      ctx.lineWidth = options?.textStrokeWidth ?? 1
    }
    ctx.textBaseline = options?.baselineOffset === undefined ? 'top' : 'alphabetic'
    if (options?.letterSpacing) {
      ctx.letterSpacing = `${options.letterSpacing}px`
    }
    const horizontalScale = options?.horizontalScale ?? 1

    const measure = (options?.hAlign && options.width) || options?.underline || options?.strikethrough
      ? ctx.measureText(text).width * horizontalScale
      : 0
    let drawX = x
    if (options?.hAlign && options.width) {
      if (options.hAlign === 'center') {
        drawX = x + (options.width - measure) / 2
      } else if (options.hAlign === 'right') {
        drawX = x + options.width - measure
      }
    }

    const drawY = y + (options?.baselineOffset ?? 0)
    if (horizontalScale === 1) {
      if (textPaintMode !== 'stroke') ctx.fillText(text, drawX, drawY)
      if (textPaintMode !== 'fill') ctx.strokeText(text, drawX, drawY)
    } else {
      ctx.save()
      ctx.translate(drawX, drawY)
      ctx.scale(horizontalScale, 1)
      if (textPaintMode !== 'stroke') ctx.fillText(text, 0, 0)
      if (textPaintMode !== 'fill') ctx.strokeText(text, 0, 0)
      ctx.restore()
    }

    if (options?.underline) {
      const lineY = y + fontSize * 0.9
      ctx.beginPath()
      ctx.moveTo(drawX, lineY)
      ctx.lineTo(drawX + measure, lineY)
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(fontSize * 0.05, 0.5)
      ctx.stroke()
    }

    if (options?.strikethrough) {
      const lineY = y + fontSize * 0.55
      ctx.beginPath()
      ctx.moveTo(drawX, lineY)
      ctx.lineTo(drawX + measure, lineY)
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(fontSize * 0.05, 0.5)
      ctx.stroke()
    }

    if (options?.letterSpacing) {
      ctx.letterSpacing = '0px'
    }
  }
}

function bytesToDataUri(
  data: Uint8Array,
  mimeType: string,
  btoaFn: (s: string) => string,
): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]!)
  return `data:${mimeType};base64,${btoaFn(binary)}`
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

// ─── COLR v1 Canvas implementation ───

/** CompositeMode → Canvas globalCompositeOperation mapping */
function compositeModeToCanvas(mode: CompositeMode): string {
  // CompositeMode enum: 0=CLEAR, 1=SRC, ..., 27=LUMINOSITY
  const map: Record<number, string> = {
    0: 'clear',           // CLEAR (non-standard but supported)
    1: 'copy',            // SRC
    2: 'destination',     // DEST (non-standard, fallback)
    3: 'source-over',     // SRC_OVER
    4: 'destination-over', // DEST_OVER
    5: 'source-in',       // SRC_IN
    6: 'destination-in',  // DEST_IN
    7: 'source-out',      // SRC_OUT
    8: 'destination-out', // DEST_OUT
    9: 'source-atop',     // SRC_ATOP
    10: 'destination-atop', // DEST_ATOP
    11: 'xor',            // XOR
    12: 'lighter',        // PLUS
    13: 'screen',         // SCREEN
    14: 'overlay',        // OVERLAY
    15: 'darken',         // DARKEN
    16: 'lighten',        // LIGHTEN
    17: 'color-dodge',    // COLOR_DODGE
    18: 'color-burn',     // COLOR_BURN
    19: 'hard-light',     // HARD_LIGHT
    20: 'soft-light',     // SOFT_LIGHT
    21: 'difference',     // DIFFERENCE
    22: 'exclusion',      // EXCLUSION
    23: 'multiply',       // MULTIPLY
    24: 'hue',            // HUE
    25: 'saturation',     // SATURATION
    26: 'color',          // COLOR
    27: 'luminosity',     // LUMINOSITY
  }
  return map[mode as number] ?? 'source-over'
}

/** Set a glyph outline as the clip path */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clipGlyphPath(ctx: any, font: Font, glyphId: number, scale: number, cx: number, baseY: number): void {
  const glyph = font.getGlyph(glyphId)
  const { commands, coords } = glyph.outline
  if (commands.length === 0) return
  ctx.beginPath()
  let ci = 0
  for (let i = 0; i < commands.length; i++) {
    switch (commands[i]) {
      case 0: // MoveTo
        ctx.moveTo(cx + coords[ci]! * scale, baseY - coords[ci + 1]! * scale)
        ci += 2
        break
      case 1: // LineTo
        ctx.lineTo(cx + coords[ci]! * scale, baseY - coords[ci + 1]! * scale)
        ci += 2
        break
      case 2: // CubicTo
        ctx.bezierCurveTo(
          cx + coords[ci]! * scale, baseY - coords[ci + 1]! * scale,
          cx + coords[ci + 2]! * scale, baseY - coords[ci + 3]! * scale,
          cx + coords[ci + 4]! * scale, baseY - coords[ci + 5]! * scale,
        )
        ci += 6
        break
      case 3: // Close
        ctx.closePath()
        break
    }
  }
  ctx.clip()
}

/** Approximate a sweep gradient by drawing it in sector subdivisions */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fillSweepGradientCanvas(
  ctx: any,
  centerX: number, centerY: number,
  startAngle: number, endAngle: number,
  stops: ResolvedColorStop[],
  extend: ExtendMode,
  scale: number, cx: number, baseY: number,
): void {
  const canvasCX = cx + centerX * scale
  const canvasCY = baseY - centerY * scale

  // Convert angles from turns → radians (sign flipped due to Y-axis inversion)
  const startRad = -startAngle * 2 * Math.PI
  const endRad = -endAngle * 2 * Math.PI

  const SECTORS = 360
  const totalAngle = endRad - startRad
  const stepAngle = totalAngle / SECTORS
  const R = 4000

  const firstOff = stops[0]?.offset ?? 0
  const lastOff = stops[stops.length - 1]?.offset ?? 1

  for (let i = 0; i < SECTORS; i++) {
    const a0 = startRad + stepAngle * i
    const a1 = a0 + stepAngle
    const t = (i + 0.5) / SECTORS

    const mapped = extend !== 0
      ? mapExtendMode(t, firstOff, lastOff, extend)
      : t
    const color = sampleColorLine(stops, mapped)

    ctx.fillStyle = colorToRgba(color)
    ctx.beginPath()
    ctx.moveTo(canvasCX, canvasCY)
    ctx.arc(canvasCX, canvasCY, R, a0, a1)
    ctx.closePath()
    ctx.fill()
  }
}

/** Create the ColrV1PaintOps implementation for Canvas */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createCanvasColrV1Ops(ctx: any, font: Font): ColrV1PaintOps {
  return {
    save() { ctx.save() },
    restore() { ctx.restore() },

    transform(xx: number, yx: number, xy: number, yy: number, dx: number, dy: number) {
      ctx.transform(xx, yx, xy, yy, dx, dy)
    },

    clipGlyph(f: Font, glyphId: number, scale: number, cx: number, baseY: number) {
      clipGlyphPath(ctx, f, glyphId, scale, cx, baseY)
    },

    clipRect(xMin: number, yMin: number, xMax: number, yMax: number, scale: number, cx: number, baseY: number) {
      const x = cx + xMin * scale
      const y = baseY - yMax * scale
      const w = (xMax - xMin) * scale
      const h = (yMax - yMin) * scale
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
    },

    fillSolid(color: ResolvedColor) {
      ctx.fillStyle = colorToRgba(color)
      ctx.fill()
    },

    fillLinearGradient(
      x0: number, y0: number, x1: number, y1: number,
      _x2: number, _y2: number,
      stops: ResolvedColorStop[], extend: ExtendMode,
      scale: number, cx: number, baseY: number,
    ) {
      const N = 10
      let usedStops = stops
      let gx0 = cx + x0 * scale
      let gy0 = baseY - y0 * scale
      let gx1 = cx + x1 * scale
      let gy1 = baseY - y1 * scale

      if (extend !== 0 && stops.length >= 2) {
        usedStops = extendGradientStops(stops, extend, N)
        const dx = (x1 - x0) * scale
        const dy = (y1 - y0) * scale
        gx0 -= N * dx
        gy0 += N * dy
        gx1 += N * dx
        gy1 -= N * dy
      }

      const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1)
      for (let si = 0; si < usedStops.length; si++) {
        const s = usedStops[si]!
        grad.addColorStop(Math.max(0, Math.min(1, s.offset)), colorToRgba(s.color))
      }
      ctx.fillStyle = grad
      ctx.fill()
    },

    fillRadialGradient(
      x0: number, y0: number, r0: number,
      x1: number, y1: number, r1: number,
      stops: ResolvedColorStop[], extend: ExtendMode,
      scale: number, cx: number, baseY: number,
    ) {
      const N = 10
      let usedStops = stops
      let gx0 = cx + x0 * scale
      let gy0 = baseY - y0 * scale
      let gr0 = r0 * scale
      let gx1 = cx + x1 * scale
      let gy1 = baseY - y1 * scale
      let gr1 = r1 * scale

      if (extend !== 0 && stops.length >= 2) {
        usedStops = extendGradientStops(stops, extend, N)
        const dx = (x1 - x0) * scale
        const dy = (y1 - y0) * scale
        const dr = (r1 - r0) * scale
        gx0 -= N * dx
        gy0 += N * dy
        gr0 = Math.max(0, gr0 - N * dr)
        gx1 += N * dx
        gy1 -= N * dy
        gr1 += N * dr
      }

      const grad = ctx.createRadialGradient(gx0, gy0, gr0, gx1, gy1, gr1)
      for (let si = 0; si < usedStops.length; si++) {
        const s = usedStops[si]!
        grad.addColorStop(Math.max(0, Math.min(1, s.offset)), colorToRgba(s.color))
      }
      ctx.fillStyle = grad
      ctx.fill()
    },

    fillSweepGradient(
      centerX: number, centerY: number,
      startAngle: number, endAngle: number,
      stops: ResolvedColorStop[], extend: ExtendMode,
      scale: number, cx: number, baseY: number,
    ) {
      fillSweepGradientCanvas(ctx, centerX, centerY, startAngle, endAngle, stops, extend, scale, cx, baseY)
    },

    setCompositeMode(mode: CompositeMode) {
      ctx.globalCompositeOperation = compositeModeToCanvas(mode)
    },

    resetCompositeMode() {
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

// ─── Utilities ───

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawRoundedRectPath(
  ctx: any,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: ResolvedRectCornerRadii,
): void {
  ctx.moveTo(x + radii.topLeft, y)
  ctx.lineTo(x + w - radii.topRight, y)
  if (radii.topRight > 0) {
    ctx.arcTo(x + w, y, x + w, y + radii.topRight, radii.topRight)
  } else {
    ctx.lineTo(x + w, y)
  }
  ctx.lineTo(x + w, y + h - radii.bottomRight)
  if (radii.bottomRight > 0) {
    ctx.arcTo(x + w, y + h, x + w - radii.bottomRight, y + h, radii.bottomRight)
  } else {
    ctx.lineTo(x + w, y + h)
  }
  ctx.lineTo(x + radii.bottomLeft, y + h)
  if (radii.bottomLeft > 0) {
    ctx.arcTo(x, y + h, x, y + h - radii.bottomLeft, radii.bottomLeft)
  } else {
    ctx.lineTo(x, y + h)
  }
  ctx.lineTo(x, y + radii.topLeft)
  if (radii.topLeft > 0) {
    ctx.arcTo(x, y, x + radii.topLeft, y, radii.topLeft)
  } else {
    ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function clamp01(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

function colorWithOpacity(color: string, opacity: number | undefined): string {
  const o = opacity == null ? 1 : clamp01(opacity)
  if (o >= 1) return color
  const rgba = parseColorToRgba(color)
  if (!rgba) return color
  return `rgba(${rgba.r},${rgba.g},${rgba.b},${clamp01(rgba.a * o)})`
}

function parseColorToRgba(color: string): { r: number, g: number, b: number, a: number } | null {
  const c = color.trim()
  if (!c) return null
  if (c.startsWith('#')) {
    const h = c.slice(1)
    if (h.length === 3) {
      return {
        r: parseInt(h[0]! + h[0]!, 16),
        g: parseInt(h[1]! + h[1]!, 16),
        b: parseInt(h[2]! + h[2]!, 16),
        a: 1,
      }
    }
    if (h.length === 4) {
      return {
        r: parseInt(h[0]! + h[0]!, 16),
        g: parseInt(h[1]! + h[1]!, 16),
        b: parseInt(h[2]! + h[2]!, 16),
        a: parseInt(h[3]! + h[3]!, 16) / 255,
      }
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      }
    }
    return null
  }
  const rgb = c.match(/^rgb\(\s*([+-]?\d+)\s*[,\s]\s*([+-]?\d+)\s*[,\s]\s*([+-]?\d+)\s*\)$/i)
  if (rgb) {
    return {
      r: Math.max(0, Math.min(255, parseInt(rgb[1]!, 10))),
      g: Math.max(0, Math.min(255, parseInt(rgb[2]!, 10))),
      b: Math.max(0, Math.min(255, parseInt(rgb[3]!, 10))),
      a: 1,
    }
  }
  const rgba = c.match(/^rgba\(\s*([+-]?\d+)\s*[,\s]\s*([+-]?\d+)\s*[,\s]\s*([+-]?\d+)\s*[,\s]\s*([+-]?\d*\.?\d+)\s*\)$/i)
  if (rgba) {
    return {
      r: Math.max(0, Math.min(255, parseInt(rgba[1]!, 10))),
      g: Math.max(0, Math.min(255, parseInt(rgba[2]!, 10))),
      b: Math.max(0, Math.min(255, parseInt(rgba[3]!, 10))),
      a: clamp01(parseFloat(rgba[4]!)),
    }
  }
  return null
}

function hashBytesFNV1a(data: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function extendGradientStopsCanvas(stops: GradientStop[], mode: ExtendMode, N: number): GradientStop[] {
  const resolved: ResolvedColorStop[] = []
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]!
    const rgba = parseColorToRgba(s.color) ?? { r: 0, g: 0, b: 0, a: 1 }
    resolved.push({
      offset: clamp01(s.offset),
      color: {
        r: rgba.r / 255,
        g: rgba.g / 255,
        b: rgba.b / 255,
        a: clamp01(rgba.a * (s.opacity ?? 1)),
      },
    })
  }
  const ext = extendGradientStops(resolved, mode, N)
  const out: GradientStop[] = []
  for (let i = 0; i < ext.length; i++) {
    const s = ext[i]!
    out.push({
      offset: clamp01(s.offset),
      color: colorToRgba(s.color),
      opacity: 1,
    })
  }
  return out
}

function requireUncoloredTilingColor(paint: TilingPatternPaint): string {
  if (paint.color === undefined) throw new Error('Uncolored tiling patterns require a use-site color')
  return paint.color
}

// ─── Transparency group / soft mask layers (A6.2/A6.3) ───

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Minimal offscreen canvas shape used for group compositing. */
interface CanvasLike {
  width: number
  height: number
  getContext(id: '2d'): any
  ownerDocument?: { createElement(tag: string): any }
}

function drawCanvasLayer(destination: CanvasLayer, source: CanvasLayer): void {
  destination.ctx.save()
  destination.ctx.setTransform(1, 0, 0, 1, 0, 0)
  destination.ctx.drawImage(
    source.canvas,
    source.originX - destination.originX,
    source.originY - destination.originY,
  )
  destination.ctx.restore()
}

function drawLocalCanvasLayer(destination: CanvasLayer, source: CanvasLayer): void {
  destination.ctx.save()
  destination.ctx.setTransform(1, 0, 0, 1, 0, 0)
  destination.ctx.drawImage(source.canvas, 0, 0)
  destination.ctx.restore()
}

function createDeviceCanvas(target: CanvasLike, width: number, height: number): CanvasLike {
  let canvas: CanvasLike
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OffscreenCanvasCtor = (globalThis as any).OffscreenCanvas
  if (typeof OffscreenCanvasCtor === 'function') canvas = new OffscreenCanvasCtor(width, height) as CanvasLike
  else if (target.ownerDocument && typeof target.ownerDocument.createElement === 'function') {
    canvas = target.ownerDocument.createElement('canvas') as CanvasLike
    canvas.width = width
    canvas.height = height
  } else {
    throw new Error('Canvas backend requires OffscreenCanvas or a DOM document to rasterize a mesh shading')
  }
  return canvas
}

function packMeshPatches(paint: MeshGradientPaint): { points: Float32Array, colors: Uint32Array } {
  const existing = paint.packedPatches
  const existingCount = existing === undefined ? 0 : Math.floor(existing.points.length / 32)
  const patchCount = paint.patches.length + existingCount
  const points = new Float32Array(patchCount * 32)
  const colors = new Uint32Array(patchCount * 4)
  for (let patchIndex = 0; patchIndex < paint.patches.length; patchIndex++) {
    const patch = paint.patches[patchIndex]!
    if (patch.points.length !== 32) throw new Error('Mesh patch must contain exactly 16 control points')
    points.set(patch.points, patchIndex * 32)
    for (let colorIndex = 0; colorIndex < 4; colorIndex++) {
      const color = parseColorToRgba(patch.colors[colorIndex]!)
      if (color === null || color.a !== 1) throw new Error('Mesh patch colors must be opaque RGB colors')
      colors[patchIndex * 4 + colorIndex] = (color.r << 16) | (color.g << 8) | color.b
    }
  }
  if (existing !== undefined) {
    points.set(existing.points, paint.patches.length * 32)
    colors.set(existing.colors, paint.patches.length * 4)
  }
  return { points, colors }
}

function placeShapeOverride(
  override: { data: Uint8ClampedArray, width: number, height: number, x: number, y: number },
  width: number,
  height: number,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(width * height)
  const left = Math.max(0, override.x)
  const top = Math.max(0, override.y)
  const right = Math.min(width, override.x + override.width)
  const bottom = Math.min(height, override.y + override.height)
  for (let y = top; y < bottom; y++) {
    const sourceOffset = (y - override.y) * override.width + left - override.x
    result.set(override.data.subarray(sourceOffset, sourceOffset + right - left), y * width + left)
  }
  return result
}

function inflateMeshCell(points: PackedMeshFillCell['points']): PackedMeshFillCell['points'] {
  const cx = (points[0] + points[2] + points[4] + points[6]) / 4
  const cy = (points[1] + points[3] + points[5] + points[7]) / 4
  const factor = 1.02
  const result: number[] = []
  for (let i = 0; i < points.length; i += 2) {
    result.push(cx + (points[i]! - cx) * factor, cy + (points[i + 1]! - cy) * factor)
  }
  return result as PackedMeshFillCell['points']
}

function averagePackedColor(a: number, b: number): number {
  const average = function (shift: number): number { return (((a >> shift) & 0xff) + ((b >> shift) & 0xff)) >> 1 }
  return (average(16) << 16) | (average(8) << 8) | average(0)
}

function packedColorDistance(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff)
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff)
  const db = (a & 0xff) - (b & 0xff)
  return dr * dr + dg * dg + db * db
}

function packedCanvasColor(value: number): string {
  return '#' + (value & 0xffffff).toString(16).padStart(6, '0')
}

interface CanvasLayer {
  canvas: CanvasLike
  ctx: any
  originX: number
  originY: number
}

interface CanvasRenderCacheEntry {
  revision: number
  canvas: CanvasLike
  scale: number
  dpr: number
  bytes: number
}

/** Bounded LRU storage for explicit-revision Canvas content layers. */
export class CanvasRenderCache {
  private entries = new Map<string, CanvasRenderCacheEntry>()
  private bytes = 0

  constructor(private readonly maxBytes = 64 * 1024 * 1024) {
    if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new Error('Canvas render cache maxBytes must be a non-negative finite number')
  }

  get(key: string, revision: number, width: number, height: number, scale: number, dpr: number): CanvasLike | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (entry.revision !== revision || entry.canvas.width !== width || entry.canvas.height !== height || entry.scale !== scale || entry.dpr !== dpr) {
      this.entries.delete(key)
      this.bytes -= entry.bytes
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.canvas
  }

  set(key: string, revision: number, canvas: CanvasLike, scale: number, dpr: number): void {
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      this.entries.delete(key)
      this.bytes -= existing.bytes
    }
    const bytes = canvas.width * canvas.height * 4
    if (bytes > this.maxBytes) return
    this.entries.set(key, { revision, canvas, scale, dpr, bytes })
    this.bytes += bytes
    while (this.bytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string
      const oldest = this.entries.get(oldestKey)!
      this.entries.delete(oldestKey)
      this.bytes -= oldest.bytes
    }
  }

  clear(): void {
    this.entries.clear()
    this.bytes = 0
  }
}

type CanvasContentCacheFrame =
  | { mode: 'reused' }
  | { mode: 'capture', cacheKey: string, revision: number, target: any, layer: CanvasLayer }

/** A soft-mask layer finalized by endSoftMask, awaiting a transparency group. */
interface CanvasMaskLayer {
  canvas: CanvasLike
  ctx: any
  /** Device-space origin of the cropped mask relative to its target surface. */
  originX: number
  originY: number
  maskType: 'luminosity' | 'alpha'
  backdrop?: [number, number, number]
  /** PDF /SMask /TR transfer function remapping the mask value (0..1). */
  transfer?: 'Identity' | RenderTransferFunction
}

/** An active beginSoftMask / beginTransparencyGroup frame. */
interface CanvasLayerFrame {
  kind: 'group' | 'mask' | 'device' | 'object' | 'overprint'
  /** The target ctx to restore/composite onto when this frame ends. */
  target: any
  layer: CanvasLayer
  /** group: whether the initial backdrop is transparent. */
  isolated?: boolean
  /** group: direct children replace earlier children within their shape. */
  knockout?: boolean
  /** group: constant alpha. */
  opacity?: number
  /** group: the soft mask to apply, or null. */
  mask?: CanvasMaskLayer | null
  /** group: device-space backdrop captured when the group began. */
  initialBackdrop?: Uint8ClampedArray
  /** group: accumulated source alpha independent of the backdrop. */
  groupAlpha?: Uint8ClampedArray
  /** group: union of object shapes before opacity and soft masks. */
  groupShape?: Uint8ClampedArray
  /** mask: type. */
  maskType?: 'luminosity' | 'alpha'
  /** mask: /BC backdrop color (DeviceRGB 0-1). */
  backdrop?: [number, number, number]
  /** mask: /SMask /TR transfer function. */
  maskTransfer?: 'Identity' | RenderTransferFunction
  deviceParams?: RenderDeviceParams
  /** device: whether the parameters require a pixel post-processing surface. */
  deviceRaster?: boolean
  /** group/object: blend mode applied against the current backdrop. */
  blendMode?: BlendMode
  /** object: PDF /AIS state used to separate shape from opacity. */
  alphaIsShape?: boolean
  /** object: constant opacity applied while drawing the object. */
  objectOpacity?: number
  /** object: shape supplied by a nested transparency group. */
  shapeOverride?: { data: Uint8ClampedArray, width: number, height: number, x: number, y: number }
  /** overprint: solid native paints observed while the object was captured. */
  printPaints?: PdfOverprintPaint[]
  /** overprint: fill and stroke plate-preservation flags. */
  overprintFill?: boolean
  overprintStroke?: boolean
  overprintMode?: OverprintMode
}

interface CanvasSemanticState {
  alphaIsShape: boolean
  textKnockout: boolean
  renderingIntent: RenderingIntent
  overprintFill: boolean
  overprintStroke: boolean
  overprintMode: OverprintMode
  blendMode: BlendMode
}

function applyCanvasDeviceTransfer(ctx: any, params: RenderDeviceParams, devicePixelsPerPoint: number): void {
  const canvas = ctx.canvas
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyDeviceRasterToRgba(image.data, canvas.width, canvas.height, params, devicePixelsPerPoint)
  ctx.putImageData(image, 0, 0)
}

function deviceParamsRequireRaster(params: RenderDeviceParams): boolean {
  const transfer = params.transferFunction
  return (transfer !== undefined && transfer !== 'Identity' && transfer !== 'Default')
    || (params.blackGeneration !== undefined && params.blackGeneration !== 'Default')
    || (params.undercolorRemoval !== undefined && params.undercolorRemoval !== 'Default')
    || (params.halftone !== undefined && params.halftone !== 'Default')
}

/** Samples a transfer-function calculator expression into a 256-entry 0..1
 *  lookup table (input i/255 -> output), clamped to [0, 1]. */
function buildTransferLut(transfer: RenderTransferFunction): number[] {
  const lut = new Array<number>(256)
  for (let i = 0; i < 256; i++) {
    const out = evaluateTransferFunctionDef(transfer, i / 255)
    lut[i] = out < 0 ? 0 : out > 1 ? 1 : out
  }
  return lut
}

/**
 * Apply a soft mask to a content layer via destination-in. For a luminosity
 * mask the mask layer's per-pixel Rec.601 luminance becomes the alpha; the
 * luminosity group was already composited over its opaque /BC backdrop while
 * it was rendered. For an alpha mask the mask's own alpha channel is used.
 */
function applyCanvasMask(content: CanvasLayer, mask: CanvasMaskLayer): void {
  const contentCtx = content.ctx
  const w = mask.canvas.width
  const h = mask.canvas.height
  let maskCanvas = mask.canvas
  // PDF /SMask /TR: a 256-entry lookup remapping the mask value 0..1.
  const lut = mask.transfer && mask.transfer !== 'Identity' ? buildTransferLut(mask.transfer) : null
  if (mask.maskType === 'luminosity') {
    const img = mask.ctx.getImageData(0, 0, w, h)
    const data = img.data
    for (let i = 0; i < data.length; i += 4) {
      const lum = (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]) / 255
      let alpha = lum
      if (lut) alpha = lut[Math.round(alpha * 255)]!
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = Math.round(alpha * 255)
    }
    mask.ctx.putImageData(img, 0, 0)
    maskCanvas = mask.canvas
  } else if (lut) {
    // Alpha mask with a transfer function: remap the alpha channel in place.
    const img = mask.ctx.getImageData(0, 0, w, h)
    const data = img.data
    for (let i = 0; i < data.length; i += 4) data[i + 3] = Math.round(lut[data[i + 3]]! * 255)
    mask.ctx.putImageData(img, 0, 0)
    maskCanvas = mask.canvas
  }
  contentCtx.save()
  contentCtx.setTransform(1, 0, 0, 1, 0, 0)
  contentCtx.globalCompositeOperation = 'destination-in'
  contentCtx.globalAlpha = 1
  contentCtx.drawImage(maskCanvas, mask.originX - content.originX, mask.originY - content.originY)
  contentCtx.restore()
}
/* eslint-enable @typescript-eslint/no-explicit-any */
