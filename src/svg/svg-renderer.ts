/**
  * SVG.
  * SvgDocument RenderBackend convertdraw.
  * ViewBox coordinateconvert apply, fill/stroke/transform process.
 */


import type {
  RenderBackend, ShapeDrawOptions, PathPaintOptions, PaintValue,
  GradientPaint, LinearGradientPaint, RadialGradientPaint, GradientStop,
} from '../renderer/backend.js'
import type {
  SvgDocument, SvgNode, SvgDefs, SvgStyle, SvgPaint, SvgColor,
  SvgGradientStop, SvgLinearGradient, SvgRadialGradient, SvgMatrix,
  SvgRect, SvgCircle, SvgEllipse, SvgGroup,
  SvgLine, SvgPolyline, SvgPolygon, SvgText, SvgImage, SvgMask, SvgDropShadowFilter, SvgFilterGraph,
} from './svg-types.js'
import { parseSvg } from './svg-parser.js'
import { detectImageFormat, getImageDimensions } from '../image/image-utils.js'
import { encodePngRgba } from '../image/png-encoder.js'
import { executeSvgFilterGraph } from './svg-filter.js'
import { decodePng } from '../image/png-parser.js'
import { decodeJpegToRgba } from '../image/jpeg-decoder.js'
import type { Font } from '../font.js'

export interface SvgImageResource {
  data: Uint8Array
  mimeType: string
}

export interface SvgRenderOptions {
  imageResources?: ReadonlyMap<string, SvgImageResource>
}

/**
  * SVG area rendering.
  * @param doc SVG.
  * @param backend draw.
  * @param x drawarealefttopX (pt)
  * @param y drawarealefttopY (pt)
  * @param width drawareawidth (pt)
  * @param height drawareaheight (pt)
 */

export function renderSvg(
  doc: SvgDocument,
  backend: RenderBackend,
  x: number, y: number,
  width: number, height: number,
  options?: SvgRenderOptions,
): void {
  backend.save()
  backend.translate(x, y)

  // ViewBox -> drawareacoordinateconvert.
  
  const viewport = resolveViewportTransform(doc, width, height)

  // Rowcolumnapply: save/translate with.
  // Cm rowcolumnrequired, translate + scale with.
  // RenderBackend translate with, coordinate previous with.


  
  const ctx: SvgRenderContext = {
    backend,
    defs: doc.defs,
    scaleX: viewport.scaleX,
    scaleY: viewport.scaleY,
    translateX: viewport.translateX,
    translateY: viewport.translateY,
    userViewportWidth: doc.viewBox.width,
    userViewportHeight: doc.viewBox.height,
    patternStack: [],
    filterReferenceStack: [],
    imageResources: options?.imageResources,
  }

  backend.clip(0, 0, width, height)

  renderNode({ type: 'g', children: doc.children, style: doc.rootStyle }, ctx, [1, 0, 0, 1, 0, 0], {})

  backend.restore()
}

/**
 * Renders an OT-SVG glyph document (SVG table) for a single glyph.
 *
 * Coordinate system per the OpenType SVG table specification: the document
 * origin coincides with the glyph origin, the y axis points down, and one
 * unit equals one font design unit. The initial viewport is the em square
 * (unitsPerEm x unitsPerEm); an explicit viewBox on the root element maps
 * to that viewport with standard preserveAspectRatio behavior. The glyph is
 * the element whose id is "glyph{glyphId}". The designated element is rendered
 * with SVG use-element semantics, independently of its original ancestors.
 * Content is not clipped to the viewport.
 *
 * @param doc Parsed SVG glyph document
 * @param backend Target backend
 * @param glyphId Glyph ID to render
 * @param originX Glyph origin X in device coordinates (pt)
 * @param originY Baseline Y in device coordinates (pt)
 * @param scale Device units per font unit (fontSize / unitsPerEm)
 * @param unitsPerEm Font design units per em
 */
export function renderSvgGlyph(
  doc: SvgDocument,
  backend: RenderBackend,
  glyphId: number,
  originX: number,
  originY: number,
  scale: number,
  unitsPerEm: number,
  options?: SvgRenderOptions & { foregroundColor?: string, paletteFont?: Font },
): void {
  const glyphViewportWidth = doc.widthPercentage !== undefined
    ? unitsPerEm * doc.widthPercentage
    : doc.hasExplicitWidth ? doc.width : unitsPerEm
  const glyphViewportHeight = doc.heightPercentage !== undefined
    ? unitsPerEm * doc.heightPercentage
    : doc.hasExplicitHeight ? doc.height : unitsPerEm
  const viewport = doc.hasExplicitViewBox
    ? computeViewBoxToViewportTransform(doc.viewBox, glyphViewportWidth, glyphViewportHeight, doc.preserveAspectRatio)
    : { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 }

  const ctx: SvgRenderContext = {
    backend,
    defs: doc.defs,
    scaleX: scale * viewport.scaleX,
    scaleY: scale * viewport.scaleY,
    translateX: scale * viewport.translateX,
    translateY: scale * viewport.translateY,
    userViewportWidth: doc.hasExplicitViewBox ? doc.viewBox.width : glyphViewportWidth,
    userViewportHeight: doc.hasExplicitViewBox ? doc.viewBox.height : glyphViewportHeight,
    patternStack: [],
    filterReferenceStack: [],
    imageResources: options?.imageResources,
    foregroundColor: options?.foregroundColor ? parseRendererColor(options.foregroundColor) : undefined,
    paletteFont: options?.paletteFont,
  }

  backend.save()
  backend.translate(originX, originY)

  const glyphElementId = `glyph${glyphId}`
  const referencedGlyph = doc.defs.references.get(glyphElementId)
  if (doc.rootId === glyphElementId) {
    for (let i = 0; i < doc.children.length; i++) {
      renderNode(doc.children[i]!, ctx, [1, 0, 0, 1, 0, 0], doc.rootStyle)
    }
  } else if (referencedGlyph !== undefined) {
    renderNode(referencedGlyph, ctx, [1, 0, 0, 1, 0, 0], doc.rootStyle)
  } else {
    // Document without per-glyph ids: the whole document is the glyph content
    for (let i = 0; i < doc.children.length; i++) {
      renderNode(doc.children[i]!, ctx, [1, 0, 0, 1, 0, 0], doc.rootStyle)
    }
  }

  backend.restore()
}

// Internaltext.


interface SvgRenderContext {
  backend: RenderBackend
  defs: SvgDefs
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
  userViewportWidth: number
  userViewportHeight: number
  patternStack: string[]
  filterReferenceStack: string[]
  imageResources?: ReadonlyMap<string, SvgImageResource>
  foregroundColor?: SvgColor
  paletteFont?: Font
}

interface ViewportTransform {
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
}

// Draw.


function renderNode(
  node: SvgNode,
  ctx: SvgRenderContext,
  parentMatrix: SvgMatrix,
  parentStyle: SvgStyle,
  suppressOwnMask = false,
): void {
  const style = mergeStyle(parentStyle, node.style)

  // Visibility: hidden.
  
  if (style.visibility === 'hidden') return

  // Currentconvertrowcolumn calculate.
  
  let matrix = parentMatrix
  if (node.transform) {
    matrix = multiplyMatrix(parentMatrix, node.transform)
  }

  const opacity = clamp01(style.opacity ?? 1)
  if (opacity <= 0) return

  if (node.maskId && !suppressOwnMask) {
    renderNodeWithMask(node, ctx, parentMatrix, parentStyle, matrix, style)
    return
  }

  const clipData = node.clipPathId
    ? resolveClipPathData(node.clipPathId, node, ctx, matrix, style)
    : null
  if (node.clipPathId && !clipData) return
  const viewportClipData = resolveNodeViewportClip(node, matrix, ctx)
  const needsPathClip = clipData !== null || viewportClipData !== null
  if (needsPathClip) {
    if (!ctx.backend.clipPath) {
      throw new Error('SVG clipPath/mask is not supported by current backend')
    }
    ctx.backend.save()
    if (clipData) {
      ctx.backend.clipPath(clipData.commands, clipData.coords, clipData.fillRule ?? 'nonzero')
    }
    if (viewportClipData) ctx.backend.clipPath(viewportClipData.commands, viewportClipData.coords, 'nonzero')
  }

  const shouldApplyOpacity = opacity < 1
  let opacityGroup = false
  if (shouldApplyOpacity) {
    if (node.type === 'g') {
      if (!ctx.backend.beginTransparencyGroup || !ctx.backend.endTransparencyGroup) {
        throw new Error('SVG group opacity requires backend transparency-group support')
      }
      const groupBounds = resolveNodeDeviceBounds(node, style, matrix, ctx)
      if (!groupBounds) {
        if (needsPathClip) ctx.backend.restore()
        return
      }
      const groupX = Math.floor(groupBounds.minX)
      const groupY = Math.floor(groupBounds.minY)
      ctx.backend.beginTransparencyGroup(
        Math.max(1, Math.ceil(groupBounds.maxX) - groupX),
        Math.max(1, Math.ceil(groupBounds.maxY) - groupY),
        { isolated: true, knockout: false, opacity, hasSoftMask: false, x: groupX, y: groupY },
      )
      opacityGroup = true
    } else {
      ctx.backend.save()
      ctx.backend.setOpacity(opacity)
    }
  }

  const includeSourceGraphic = renderNodeShadow(node, style, ctx, matrix, opacity)

  if (includeSourceGraphic) {
    let filterClipApplied = false
    let filterBlendApplied = false
    if (node.filterId) {
      const filter = ctx.defs.filters.get(node.filterId)
      if (filter?.type === 'drop-shadow') {
        const filterRegion = resolveFilterRegionPath(node, filter, matrix, ctx, style)
        if (filterRegion) {
          if (!ctx.backend.clipPath) {
            throw new Error('SVG filter clipping is not supported by current backend')
          }
          ctx.backend.save()
          ctx.backend.clipPath(filterRegion.commands, filterRegion.coords, 'nonzero')
          filterClipApplied = true
        }
        if (filter.blendMode !== 'normal') {
          if (!ctx.backend.setBlendMode) {
            throw new Error('SVG filter blend mode is not supported by current backend')
          }
          ctx.backend.save()
          ctx.backend.setBlendMode(filter.blendMode)
          filterBlendApplied = true
        }
      }
    }

    switch (node.type) {
      case 'g':
        renderGroup(node, ctx, matrix, style)
        break
      case 'path':
        renderPath(node.commands, node.coords, style, ctx, matrix, node.d)
        break
      case 'rect':
        renderRect(node, style, ctx, matrix)
        break
      case 'circle':
        renderCircle(node, style, ctx, matrix)
        break
      case 'ellipse':
        renderEllipse(node, style, ctx, matrix)
        break
      case 'line':
        renderLine(node, style, ctx, matrix)
        break
      case 'polyline':
        renderPolyline(node, style, ctx, matrix)
        break
      case 'polygon':
        renderPolygon(node, style, ctx, matrix)
        break
      case 'text':
        renderText(node, style, ctx, matrix)
        break
      case 'image':
        renderImage(node, ctx, matrix)
        break
    }

    if (filterBlendApplied) ctx.backend.restore()
    if (filterClipApplied) ctx.backend.restore()
  }

  if (shouldApplyOpacity) {
    if (opacityGroup) ctx.backend.endTransparencyGroup!()
    else ctx.backend.restore()
  }
  if (needsPathClip) {
    ctx.backend.restore()
  }
}

function renderNodeWithMask(
  node: SvgNode,
  ctx: SvgRenderContext,
  parentMatrix: SvgMatrix,
  parentStyle: SvgStyle,
  matrix: SvgMatrix,
  style: SvgStyle,
): void {
  const mask = ctx.defs.masks.get(node.maskId!)
  if (!mask) return
  if (!ctx.backend.beginSoftMask || !ctx.backend.endSoftMask || !ctx.backend.beginTransparencyGroup || !ctx.backend.endTransparencyGroup) {
    throw new Error('SVG mask requires backend soft-mask and transparency-group support')
  }

  let bounds: CoordBounds | null = null
  if (mask.maskUnits === 'objectBoundingBox' || mask.maskContentUnits === 'objectBoundingBox') {
    bounds = computeRenderedNodePaintBounds(node, style, matrix)
    if (!bounds) return
  }
  const region = resolveMaskRegionPath(mask, bounds)
  if (!region) return
  const userRegion = mask.maskUnits === 'userSpaceOnUse'
    ? transformPathByMatrix(region.commands, region.coords, matrix)
    : region
  const deviceRegion = applyViewportToPathData(userRegion, ctx)
  const deviceBounds = computeCoordBounds(deviceRegion.coords)
  if (!deviceBounds) return
  const groupX = Math.floor(deviceBounds.minX)
  const groupY = Math.floor(deviceBounds.minY)
  const groupWidth = Math.max(1, Math.ceil(deviceBounds.maxX) - groupX)
  const groupHeight = Math.max(1, Math.ceil(deviceBounds.maxY) - groupY)

  ctx.backend.beginSoftMask(mask.maskType === 'alpha' ? 'alpha' : 'luminosity', groupWidth, groupHeight, undefined, undefined, groupX, groupY)
  ctx.backend.save()
  ctx.backend.clipPath(deviceRegion.commands, deviceRegion.coords, 'nonzero')

  let contentMatrix = matrix
  if (mask.maskContentUnits === 'objectBoundingBox') {
    const box = bounds!
    contentMatrix = [box.width, 0, 0, box.height, box.minX, box.minY]
  }
  for (let i = 0; i < mask.children.length; i++) renderNode(mask.children[i]!, ctx, contentMatrix, {})

  ctx.backend.restore()
  ctx.backend.endSoftMask()
  ctx.backend.beginTransparencyGroup(groupWidth, groupHeight, {
    isolated: true,
    knockout: false,
    opacity: 1,
    hasSoftMask: true,
    x: groupX,
    y: groupY,
  })
  renderNode(node, ctx, parentMatrix, parentStyle, true)
  ctx.backend.endTransparencyGroup()
}

function renderGroup(
  node: SvgGroup,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
  style: SvgStyle,
): void {
  if (nodeUsesBackgroundInput(node, ctx)) {
    renderBackgroundGroupRaster(node, ctx, matrix, style)
    return
  }
  for (let i = 0; i < node.children.length; i++) {
    renderNode(node.children[i]!, ctx, matrix, style)
  }
}

function renderBackgroundGroupRaster(node: SvgGroup, ctx: SvgRenderContext, matrix: SvgMatrix, style: SvgStyle): void {
  if (!ctx.backend.drawImageData) throw new Error('SVG background filter inputs require backend image-data rendering')
  const bounds = resolveNodeDeviceBounds(node, style, matrix, ctx)
  if (!bounds) return
  const minX = Math.floor(bounds.minX)
  const minY = Math.floor(bounds.minY)
  const width = Math.ceil(bounds.maxX) - minX
  const height = Math.ceil(bounds.maxY) - minY
  if (!(width > 0) || !(height > 0)) return
  if (width * height > 12_000_000) throw new Error('SVG enable-background region exceeds the raster limit')
  const raster = createRasterContext2D(width, height)
  if (!raster) throw new Error('SVG enable-background requires a raster context')
  drawShadowSourceAlphaNode(node, { ...style, opacity: 1 }, matrix, ctx, raster, minX, minY, true)
  const image = raster.getImageData(0, 0, width, height).data
  ctx.backend.drawImageData(minX, minY, width, height, encodePngRgba(width, height, new Uint8Array(image.buffer, image.byteOffset, image.byteLength)), 'image/png')
}

function nodeUsesBackgroundInput(node: SvgNode, ctx: SvgRenderContext): boolean {
  if (node.filterId) {
    const filter = ctx.defs.filters.get(node.filterId)
    if (filter?.type === 'graph' && primitivesUseBackground(filter.primitives)) return true
  }
  if (node.type === 'g') {
    for (let i = 0; i < node.children.length; i++) if (nodeUsesBackgroundInput(node.children[i]!, ctx)) return true
  }
  return false
}

function primitivesUseBackground(primitives: SvgFilterGraph['primitives']): boolean {
  for (let i = 0; i < primitives.length; i++) {
    const primitive = primitives[i]!
    if (primitive.attributes.in === 'BackgroundImage' || primitive.attributes.in === 'BackgroundAlpha'
      || primitive.attributes.in2 === 'BackgroundImage' || primitive.attributes.in2 === 'BackgroundAlpha'
      || primitivesUseBackground(primitive.children)) return true
  }
  return false
}

function renderNodeShadow(
  node: SvgNode,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
  nodeOpacity: number,
): boolean {
  if (!node.filterId) return true
  const filter = ctx.defs.filters.get(node.filterId)
  if (!filter) return true
  if (filter.type === 'graph') {
    renderFilterGraphRaster(node, style, ctx, matrix, filter)
    return false
  }
  if (node.type === 'text') {
    throw new Error(`SVG filter "${node.filterId}" on <${node.type}> is not supported`)
  }

  const shadowStyle = node.type === 'g'
    ? makeGroupDropShadowStyle(style, filter.color)
    : makeDropShadowStyle(style, filter.color)
  if (!shadowStyle.fill || shadowStyle.fill.type === 'none') {
    if (!shadowStyle.stroke || shadowStyle.stroke.type === 'none') return filter.includeSourceGraphic
  }

  const shadowMetrics = resolveFilterShadowMetrics(node, style, matrix, filter)
  const filterRegion = resolveFilterRegionPath(node, filter, matrix, ctx, style)
  const blurSigmaX = Math.max(0, shadowMetrics.stdDeviationX * approxRenderScaleX(matrix, ctx))
  const blurSigmaY = Math.max(0, shadowMetrics.stdDeviationY * approxRenderScaleY(matrix, ctx))
  const blurSourceMax = Math.max(shadowMetrics.stdDeviationX, shadowMetrics.stdDeviationY)
  const filterOpacity = clamp01(filter.opacity)
  if (filterOpacity <= 0 || nodeOpacity <= 0) return filter.includeSourceGraphic

  // Blur draw PDF/Canvas with child,.
  // SourceAlpha -> GaussianBlur -> Offset with.


  if (blurSourceMax >= 3 || node.type === 'image') {
    const rasterized = renderDropShadowRaster(
      node,
      style,
      ctx,
      matrix,
      shadowMetrics,
      filter,
      filterRegion,
      blurSigmaX,
      blurSigmaY,
    )
    if (!rasterized) {
      throw new Error(`SVG filter "${node.filterId}" raster stage failed`)
    }
    return filter.includeSourceGraphic
  }

  const shadowMatrix = multiplyMatrix(matrix, [1, 0, 0, 1, shadowMetrics.dx, shadowMetrics.dy])
  const baseOpacity = clamp01(nodeOpacity * filterOpacity)
  if (baseOpacity <= 0) return filter.includeSourceGraphic

  const passes = buildDropShadowKernel(blurSigmaX, blurSigmaY)
  let accumulatedTargetAlpha = 0
  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i]!
    // Source-over with bottom.
    // (baseOpacity * weight) eachpath.
    
    
    const targetContribution = baseOpacity * pass.weight
    const denom = Math.max(1e-9, 1 - accumulatedTargetAlpha)
    const passOpacity = clamp01(targetContribution / denom)
    accumulatedTargetAlpha = Math.min(1, accumulatedTargetAlpha + targetContribution)
    if (passOpacity <= 0) continue
    ctx.backend.save()
    if (filterRegion && ctx.backend.clipPath) {
      ctx.backend.clipPath(filterRegion.commands, filterRegion.coords, 'nonzero')
    }
    if (Math.abs(pass.dx) > 1e-9 || Math.abs(pass.dy) > 1e-9) {
      ctx.backend.translate(pass.dx, pass.dy)
    }
    if (passOpacity < 1) {
      ctx.backend.setOpacity(passOpacity)
    }

    switch (node.type) {
      case 'g':
        renderGroupShadowGeometry(node.children, style, ctx, matrix, shadowMetrics.dx, shadowMetrics.dy, filter.color)
        break
      case 'path':
        renderPath(node.commands, node.coords, shadowStyle, ctx, shadowMatrix, node.d)
        break
      case 'rect':
        renderRect(node, shadowStyle, ctx, shadowMatrix)
        break
      case 'circle':
        renderCircle(node, shadowStyle, ctx, shadowMatrix)
        break
      case 'ellipse':
        renderEllipse(node, shadowStyle, ctx, shadowMatrix)
        break
      case 'line':
        renderLine(node, shadowStyle, ctx, shadowMatrix)
        break
      case 'polyline':
        renderPolyline(node, shadowStyle, ctx, shadowMatrix)
        break
      case 'polygon':
        renderPolygon(node, shadowStyle, ctx, shadowMatrix)
        break
      default:
        break
    }

    ctx.backend.restore()
  }
  return filter.includeSourceGraphic
}

function renderGroupShadowGeometry(
  children: SvgNode[],
  parentStyle: SvgStyle,
  ctx: SvgRenderContext,
  parentMatrix: SvgMatrix,
  shadowDx: number,
  shadowDy: number,
  shadowColor?: SvgColor,
): void {
  for (let i = 0; i < children.length; i++) {
    renderShadowNodeGeometry(children[i]!, parentStyle, ctx, parentMatrix, shadowDx, shadowDy, shadowColor)
  }
}

function renderShadowNodeGeometry(
  node: SvgNode,
  parentStyle: SvgStyle,
  ctx: SvgRenderContext,
  parentMatrix: SvgMatrix,
  shadowDx: number,
  shadowDy: number,
  shadowColor?: SvgColor,
): void {
  const style = mergeStyle(parentStyle, node.style)
  if (style.display === 'none' || style.visibility === 'hidden') return

  let matrix = parentMatrix
  if (node.transform) {
    matrix = multiplyMatrix(parentMatrix, node.transform)
  }

  if (node.type === 'g') {
    renderGroupShadowGeometry(node.children, style, ctx, matrix, shadowDx, shadowDy, shadowColor)
    return
  }
  if (node.type === 'text' || node.type === 'image') return

  const shadowStyle = makeDropShadowStyle(style, shadowColor)
  if (!shadowStyle.fill || shadowStyle.fill.type === 'none') {
    if (!shadowStyle.stroke || shadowStyle.stroke.type === 'none') return
  }
  const shadowMatrix = multiplyMatrix(matrix, [1, 0, 0, 1, shadowDx, shadowDy])

  switch (node.type) {
    case 'path':
      renderPath(node.commands, node.coords, shadowStyle, ctx, shadowMatrix, node.d)
      break
    case 'rect':
      renderRect(node, shadowStyle, ctx, shadowMatrix)
      break
    case 'circle':
      renderCircle(node, shadowStyle, ctx, shadowMatrix)
      break
    case 'ellipse':
      renderEllipse(node, shadowStyle, ctx, shadowMatrix)
      break
    case 'line':
      renderLine(node, shadowStyle, ctx, shadowMatrix)
      break
    case 'polyline':
      renderPolyline(node, shadowStyle, ctx, shadowMatrix)
      break
    case 'polygon':
      renderPolygon(node, shadowStyle, ctx, shadowMatrix)
      break
    default:
      break
  }
}

function makeDropShadowStyle(style: SvgStyle, shadowColor?: SvgColor): SvgStyle {
  const c = shadowColor ?? { r: 0, g: 0, b: 0 }
  const out: SvgStyle = { ...style }
  out.opacity = 1
  if (style.fill && style.fill.type !== 'none') {
    out.fill = { type: 'color', color: { r: c.r, g: c.g, b: c.b }, opacity: style.fill.opacity ?? 1 }
  } else {
    out.fill = { type: 'none' }
  }
  if (style.stroke && style.stroke.type !== 'none') {
    out.stroke = { type: 'color', color: { r: c.r, g: c.g, b: c.b }, opacity: style.stroke.opacity ?? 1 }
  } else {
    out.stroke = { type: 'none' }
  }
  out.fillOpacity = style.fillOpacity ?? 1
  out.strokeOpacity = style.strokeOpacity ?? 1
  return out
}

function makeGroupDropShadowStyle(style: SvgStyle, shadowColor?: SvgColor): SvgStyle {
  const c = shadowColor ?? { r: 0, g: 0, b: 0 }
  return {
    fill: { type: 'color', color: { r: c.r, g: c.g, b: c.b }, opacity: 1 },
    stroke: { type: 'color', color: { r: c.r, g: c.g, b: c.b }, opacity: 1 },
    fillOpacity: style.fillOpacity ?? 1,
    strokeOpacity: style.strokeOpacity ?? 1,
    strokeWidth: style.strokeWidth ?? 1,
    strokeLinecap: style.strokeLinecap,
    strokeLinejoin: style.strokeLinejoin,
    strokeMiterLimit: style.strokeMiterLimit,
    strokeDasharray: style.strokeDasharray,
    strokeDashoffset: style.strokeDashoffset,
    fillRule: style.fillRule ?? 'nonzero',
    opacity: 1,
  }
}

interface DropShadowPass {
  dx: number
  dy: number
  weight: number
}

function buildDropShadowKernel(sigmaX: number, sigmaY: number): DropShadowPass[] {
  if (!(sigmaX > 1e-3) && !(sigmaY > 1e-3)) {
    return [{ dx: 0, dy: 0, weight: 1 }]
  }

  // Draw (Canvas/PDF)child with,.
  // 1 path.
  
  
  const maxPasses = 25
  const targetRadiusX = Math.ceil(Math.max(1, sigmaX * 3))
  const targetRadiusY = Math.ceil(Math.max(1, sigmaY * 3))
  const targetRadius = Math.max(targetRadiusX, targetRadiusY)
  const fullGrid = (targetRadius * 2 + 1) * (targetRadius * 2 + 1)
  const step = fullGrid <= maxPasses
    ? 1
    : Math.ceil(Math.sqrt(fullGrid / maxPasses))
  const radiusX = Math.max(1, Math.floor(targetRadiusX / step))
  const radiusY = Math.max(1, Math.floor(targetRadiusY / step))

  const passes: DropShadowPass[] = []
  for (let gy = -radiusY; gy <= radiusY; gy++) {
    for (let gx = -radiusX; gx <= radiusX; gx++) {
      const dx = gx * step
      const dy = gy * step
      const weight = gaussianWeight2D(dx, dy, sigmaX, sigmaY)
      if (weight <= 1e-9) continue
      passes.push({ dx, dy, weight })
    }
  }

  let total = 0
  for (let i = 0; i < passes.length; i++) total += passes[i]!.weight
  if (total <= 1e-9) return [{ dx: 0, dy: 0, weight: 1 }]
  for (let i = 0; i < passes.length; i++) {
    passes[i]!.weight /= total
  }
  // () from draw.
  
  passes.sort((a, b) => b.weight - a.weight)
  return passes
}

function gaussianWeight2D(dx: number, dy: number, sigmaX: number, sigmaY: number): number {
  const sx = sigmaX > 1e-6 ? sigmaX : 1e-6
  const sy = sigmaY > 1e-6 ? sigmaY : 1e-6
  const tx = (dx * dx) / (2 * sx * sx)
  const ty = (dy * dy) / (2 * sy * sy)
  return Math.exp(-(tx + ty))
}

interface Raster2DContext {
  canvas: { width: number, height: number }
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(
    cp1x: number, cp1y: number,
    cp2x: number, cp2y: number,
    x: number, y: number,
  ): void
  closePath(): void
  fill(fillRule?: 'nonzero' | 'evenodd'): void
  stroke(): void
  fillWithPaint?(paint: GradientPaint, originX: number, originY: number, fillRule?: 'nonzero' | 'evenodd'): void
  fillWithRaster?(source: Float32Array, fillRule?: 'nonzero' | 'evenodd'): void
  strokeWithPaint?(paint: GradientPaint, originX: number, originY: number): void
  snapshotPremultiplied?(): Float32Array
  compositePremultiplied?(source: Float32Array, opacity?: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray }
  drawImageRgbaAffine?(rgba: Uint8Array, sourceWidth: number, sourceHeight: number, matrix: SvgMatrix): void
  setLineDash?(segments: number[]): void
  globalAlpha: number
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  lineCap: 'butt' | 'round' | 'square'
  lineJoin: 'miter' | 'round' | 'bevel'
  miterLimit: number
  lineDashOffset: number
}

type RasterLineCap = 'butt' | 'round' | 'square'
type RasterLineJoin = 'miter' | 'round' | 'bevel'

interface RasterPoint {
  x: number
  y: number
}

interface RasterSubpath {
  points: RasterPoint[]
  closed: boolean
}

interface RasterStrokeSegment {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface RasterState {
  globalAlpha: number
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  lineCap: RasterLineCap
  lineJoin: RasterLineJoin
  miterLimit: number
  lineDash: number[]
  lineDashOffset: number
}

class SoftwareRasterContext implements Raster2DContext {
  canvas: { width: number, height: number }
  globalAlpha = 1
  fillStyle = '#000000'
  strokeStyle = '#000000'
  lineWidth = 1
  lineCap: RasterLineCap = 'butt'
  lineJoin: RasterLineJoin = 'miter'
  miterLimit = 4
  lineDashOffset = 0

  private rgba: Float32Array
  private commands: number[] = []
  private coords: number[] = []
  private lineDash: number[] = []
  private states: RasterState[] = []

  constructor(width: number, height: number) {
    this.canvas = { width, height }
    this.rgba = new Float32Array(width * height * 4)
  }

  save(): void {
    this.states.push({
      globalAlpha: this.globalAlpha,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      miterLimit: this.miterLimit,
      lineDash: this.lineDash.slice(),
      lineDashOffset: this.lineDashOffset,
    })
  }

  restore(): void {
    const s = this.states.pop()
    if (!s) return
    this.globalAlpha = s.globalAlpha
    this.fillStyle = s.fillStyle
    this.strokeStyle = s.strokeStyle
    this.lineWidth = s.lineWidth
    this.lineCap = s.lineCap
    this.lineJoin = s.lineJoin
    this.miterLimit = s.miterLimit
    this.lineDash = s.lineDash
    this.lineDashOffset = s.lineDashOffset
  }

  beginPath(): void {
    this.commands = []
    this.coords = []
  }

  moveTo(x: number, y: number): void {
    this.commands.push(0)
    this.coords.push(x, y)
  }

  lineTo(x: number, y: number): void {
    this.commands.push(1)
    this.coords.push(x, y)
  }

  bezierCurveTo(
    cp1x: number, cp1y: number,
    cp2x: number, cp2y: number,
    x: number, y: number,
  ): void {
    this.commands.push(2)
    this.coords.push(cp1x, cp1y, cp2x, cp2y, x, y)
  }

  closePath(): void {
    this.commands.push(3)
  }

  fill(fillRule?: 'nonzero' | 'evenodd'): void {
    const a = clamp01(this.globalAlpha)
    if (a <= 0) return
    if (this.commands.length === 0) return
    const subpaths = flattenRasterPath(this.commands, this.coords, 0.6)
    if (subpaths.length === 0) return
    const coverage = new Float32Array(this.canvas.width * this.canvas.height)
    rasterFill(
      coverage,
      this.canvas.width,
      this.canvas.height,
      subpaths,
      fillRule ?? 'nonzero',
      a,
    )
    compositeRasterColor(this.rgba, coverage, parseRasterColor(this.fillStyle))
  }

  fillWithPaint(
    paint: GradientPaint,
    originX: number,
    originY: number,
    fillRule?: 'nonzero' | 'evenodd',
  ): void {
    const a = clamp01(this.globalAlpha)
    if (a <= 0 || this.commands.length === 0) return
    const subpaths = flattenRasterPath(this.commands, this.coords, 0.6)
    if (subpaths.length === 0) return
    const coverage = new Float32Array(this.canvas.width * this.canvas.height)
    rasterFill(coverage, this.canvas.width, this.canvas.height, subpaths, fillRule ?? 'nonzero', a)
    compositeRasterGradient(this.rgba, coverage, this.canvas.width, paint, originX, originY)
  }

  fillWithRaster(source: Float32Array, fillRule?: 'nonzero' | 'evenodd'): void {
    if (source.length !== this.rgba.length) throw new Error('SVG pattern raster dimensions do not match the filter source')
    const a = clamp01(this.globalAlpha)
    if (a <= 0 || this.commands.length === 0) return
    const subpaths = flattenRasterPath(this.commands, this.coords, 0.6)
    if (subpaths.length === 0) return
    const coverage = new Float32Array(this.canvas.width * this.canvas.height)
    rasterFill(coverage, this.canvas.width, this.canvas.height, subpaths, fillRule ?? 'nonzero', a)
    compositePremultipliedRaster(this.rgba, source, coverage)
  }

  snapshotPremultiplied(): Float32Array {
    return this.rgba.slice()
  }

  compositePremultiplied(source: Float32Array, opacity = 1): void {
    if (source.length !== this.rgba.length) throw new Error('SVG raster layer dimensions do not match')
    const layerOpacity = clamp01(opacity)
    for (let p = 0; p < source.length; p += 4) {
      const sourceAlpha = clamp01(source[p + 3]! * layerOpacity)
      if (sourceAlpha <= 0) continue
      const inverse = 1 - sourceAlpha
      this.rgba[p] = source[p]! * layerOpacity + this.rgba[p]! * inverse
      this.rgba[p + 1] = source[p + 1]! * layerOpacity + this.rgba[p + 1]! * inverse
      this.rgba[p + 2] = source[p + 2]! * layerOpacity + this.rgba[p + 2]! * inverse
      this.rgba[p + 3] = sourceAlpha + this.rgba[p + 3]! * inverse
    }
  }

  stroke(): void {
    const a = clamp01(this.globalAlpha)
    if (a <= 0) return
    const width = Math.max(0, this.lineWidth)
    if (!(width > 0)) return
    if (this.commands.length === 0) return
    const subpaths = flattenRasterPath(this.commands, this.coords, 0.6)
    if (subpaths.length === 0) return
    const coverage = new Float32Array(this.canvas.width * this.canvas.height)
    rasterStroke(
      coverage,
      this.canvas.width,
      this.canvas.height,
      subpaths,
      width,
      this.lineCap,
      this.lineJoin,
      this.miterLimit,
      this.lineDash,
      this.lineDashOffset,
      a,
    )
    compositeRasterColor(this.rgba, coverage, parseRasterColor(this.strokeStyle))
  }

  strokeWithPaint(paint: GradientPaint, originX: number, originY: number): void {
    const a = clamp01(this.globalAlpha)
    const width = Math.max(0, this.lineWidth)
    if (a <= 0 || !(width > 0) || this.commands.length === 0) return
    const subpaths = flattenRasterPath(this.commands, this.coords, 0.6)
    if (subpaths.length === 0) return
    const coverage = new Float32Array(this.canvas.width * this.canvas.height)
    rasterStroke(
      coverage,
      this.canvas.width,
      this.canvas.height,
      subpaths,
      width,
      this.lineCap,
      this.lineJoin,
      this.miterLimit,
      this.lineDash,
      this.lineDashOffset,
      a,
    )
    compositeRasterGradient(this.rgba, coverage, this.canvas.width, paint, originX, originY)
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    const x0 = Math.max(0, Math.floor(x))
    const y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(this.canvas.width, Math.ceil(x + width))
    const y1 = Math.min(this.canvas.height, Math.ceil(y + height))
    if (x0 <= 0 && y0 <= 0 && x1 >= this.canvas.width && y1 >= this.canvas.height) {
      this.rgba.fill(0)
      return
    }
    for (let yy = y0; yy < y1; yy++) {
      const row = yy * this.canvas.width
      for (let xx = x0; xx < x1; xx++) {
        const p = (row + xx) * 4
        this.rgba[p] = 0
        this.rgba[p + 1] = 0
        this.rgba[p + 2] = 0
        this.rgba[p + 3] = 0
      }
    }
  }

  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray } {
    const out = new Uint8ClampedArray(width * height * 4)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    for (let yy = 0; yy < height; yy++) {
      const sy = yy + y0
      if (sy < 0 || sy >= this.canvas.height) continue
      const srcRow = sy * this.canvas.width
      const dstRow = yy * width
      for (let xx = 0; xx < width; xx++) {
        const sx = xx + x0
        if (sx < 0 || sx >= this.canvas.width) continue
        const source = (srcRow + sx) * 4
        const p = (dstRow + xx) * 4
        const alpha = this.rgba[source + 3]!
        if (alpha > 1e-9) {
          out[p] = Math.round(clamp01(this.rgba[source]! / alpha) * 255)
          out[p + 1] = Math.round(clamp01(this.rgba[source + 1]! / alpha) * 255)
          out[p + 2] = Math.round(clamp01(this.rgba[source + 2]! / alpha) * 255)
        }
        out[p + 3] = Math.round(clamp01(alpha) * 255)
      }
    }
    return { data: out }
  }

  setLineDash(segments: number[]): void {
    const cleaned: number[] = []
    for (let i = 0; i < segments.length; i++) {
      const v = segments[i]!
      if (Number.isFinite(v) && v > 1e-6) cleaned.push(v)
    }
    this.lineDash = cleaned
  }

  drawImageRgbaAffine(rgba: Uint8Array, sourceWidth: number, sourceHeight: number, matrix: SvgMatrix): void {
    const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
    if (Math.abs(determinant) <= 1e-12) return
    const corners = [
      transformRasterPoint(matrix, 0, 0), transformRasterPoint(matrix, 1, 0),
      transformRasterPoint(matrix, 1, 1), transformRasterPoint(matrix, 0, 1),
    ]
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (let i = 0; i < corners.length; i++) {
      minX = Math.min(minX, corners[i]!.x); minY = Math.min(minY, corners[i]!.y)
      maxX = Math.max(maxX, corners[i]!.x); maxY = Math.max(maxY, corners[i]!.y)
    }
    const inverseA = matrix[3] / determinant
    const inverseB = -matrix[1] / determinant
    const inverseC = -matrix[2] / determinant
    const inverseD = matrix[0] / determinant
    for (let y = Math.max(0, Math.floor(minY)); y < Math.min(this.canvas.height, Math.ceil(maxY)); y++) {
      for (let x = Math.max(0, Math.floor(minX)); x < Math.min(this.canvas.width, Math.ceil(maxX)); x++) {
        const dx = x + 0.5 - matrix[4]
        const dy = y + 0.5 - matrix[5]
        const u = inverseA * dx + inverseC * dy
        const v = inverseB * dx + inverseD * dy
        if (u < 0 || v < 0 || u >= 1 || v >= 1) continue
        const sourceX = Math.min(sourceWidth - 1, Math.floor(u * sourceWidth))
        const sourceY = Math.min(sourceHeight - 1, Math.floor(v * sourceHeight))
        const source = (sourceY * sourceWidth + sourceX) * 4
        const alpha = rgba[source + 3]! / 255 * this.globalAlpha
        if (alpha <= 0) continue
        const target = (y * this.canvas.width + x) * 4
        const inverse = 1 - alpha
        this.rgba[target] = rgba[source]! / 255 * alpha + this.rgba[target]! * inverse
        this.rgba[target + 1] = rgba[source + 1]! / 255 * alpha + this.rgba[target + 1]! * inverse
        this.rgba[target + 2] = rgba[source + 2]! / 255 * alpha + this.rgba[target + 2]! * inverse
        this.rgba[target + 3] = alpha + this.rgba[target + 3]! * inverse
      }
    }
  }
}

function transformRasterPoint(matrix: SvgMatrix, x: number, y: number): { x: number, y: number } {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }
}

function parseRasterColor(value: string): { r: number, g: number, b: number, a: number } {
  const color = parseCssRasterHex(value)
  return color ?? { r: 0, g: 0, b: 0, a: 1 }
}

function parseCssRasterHex(value: string): { r: number, g: number, b: number, a: number } | null {
  if (value.length === 7 && value.charCodeAt(0) === 35) {
    const r = Number.parseInt(value.slice(1, 3), 16)
    const g = Number.parseInt(value.slice(3, 5), 16)
    const b = Number.parseInt(value.slice(5, 7), 16)
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r: r / 255, g: g / 255, b: b / 255, a: 1 }
  }
  return null
}

function compositeRasterColor(
  destination: Float32Array,
  coverage: Float32Array,
  color: { r: number, g: number, b: number, a: number },
): void {
  for (let i = 0; i < coverage.length; i++) {
    const sourceAlpha = clamp01(coverage[i]! * color.a)
    if (sourceAlpha <= 0) continue
    const p = i * 4
    const inverse = 1 - sourceAlpha
    destination[p] = color.r * sourceAlpha + destination[p]! * inverse
    destination[p + 1] = color.g * sourceAlpha + destination[p + 1]! * inverse
    destination[p + 2] = color.b * sourceAlpha + destination[p + 2]! * inverse
    destination[p + 3] = sourceAlpha + destination[p + 3]! * inverse
  }
}

function compositeRasterGradient(
  destination: Float32Array,
  coverage: Float32Array,
  width: number,
  paint: GradientPaint,
  originX: number,
  originY: number,
): void {
  const stops = prepareRasterGradientStops(paint.stops)
  if (stops.length === 0) return
  for (let i = 0; i < coverage.length; i++) {
    const shapeCoverage = coverage[i]!
    if (shapeCoverage <= 0) continue
    const x = i % width + originX + 0.5
    const y = Math.floor(i / width) + originY + 0.5
    const rawT = paint.type === 'linear-gradient'
      ? resolveLinearRasterGradientOffset(paint, x, y)
      : resolveRadialRasterGradientOffset(paint, x, y)
    const t = applyRasterGradientSpread(rawT, paint.spreadMethod ?? 'pad')
    const color = sampleRasterGradientStops(stops, t)
    const sourceAlpha = clamp01(shapeCoverage * color.a)
    if (sourceAlpha <= 0) continue
    const p = i * 4
    const inverse = 1 - sourceAlpha
    destination[p] = color.r * sourceAlpha + destination[p]! * inverse
    destination[p + 1] = color.g * sourceAlpha + destination[p + 1]! * inverse
    destination[p + 2] = color.b * sourceAlpha + destination[p + 2]! * inverse
    destination[p + 3] = sourceAlpha + destination[p + 3]! * inverse
  }
}

function compositePremultipliedRaster(
  destination: Float32Array,
  source: Float32Array,
  coverage: Float32Array,
): void {
  for (let i = 0; i < coverage.length; i++) {
    const mask = clamp01(coverage[i]!)
    if (mask <= 0) continue
    const p = i * 4
    const sourceAlpha = clamp01(source[p + 3]! * mask)
    if (sourceAlpha <= 0) continue
    const inverse = 1 - sourceAlpha
    destination[p] = source[p]! * mask + destination[p]! * inverse
    destination[p + 1] = source[p + 1]! * mask + destination[p + 1]! * inverse
    destination[p + 2] = source[p + 2]! * mask + destination[p + 2]! * inverse
    destination[p + 3] = sourceAlpha + destination[p + 3]! * inverse
  }
}

interface RasterGradientStop {
  offset: number
  r: number
  g: number
  b: number
  a: number
}

function prepareRasterGradientStops(stops: GradientStop[]): RasterGradientStop[] {
  const out: RasterGradientStop[] = []
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!
    const color = parseRasterColor(stop.color)
    out.push({
      offset: clamp01(stop.offset),
      r: color.r,
      g: color.g,
      b: color.b,
      a: clamp01(color.a * (stop.opacity ?? 1)),
    })
  }
  out.sort((a, b) => a.offset - b.offset)
  return out
}

function resolveLinearRasterGradientOffset(paint: LinearGradientPaint, x: number, y: number): number {
  const dx = paint.x2 - paint.x1
  const dy = paint.y2 - paint.y1
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= 1e-18) return 1
  return ((x - paint.x1) * dx + (y - paint.y1) * dy) / lengthSquared
}

function resolveRadialRasterGradientOffset(paint: RadialGradientPaint, x: number, y: number): number {
  const fx = paint.fx ?? paint.cx
  const fy = paint.fy ?? paint.cy
  const fr = Math.max(0, paint.fr ?? 0)
  const dcx = paint.cx - fx
  const dcy = paint.cy - fy
  const dr = paint.r - fr
  const px = x - fx
  const py = y - fy
  const a = dcx * dcx + dcy * dcy - dr * dr
  const b = -2 * (px * dcx + py * dcy + fr * dr)
  const c = px * px + py * py - fr * fr
  if (Math.abs(a) <= 1e-12) {
    if (Math.abs(b) <= 1e-12) return c <= 0 ? 0 : 1
    return -c / b
  }
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return 1
  const root = Math.sqrt(discriminant)
  const t0 = (-b - root) / (2 * a)
  const t1 = (-b + root) / (2 * a)
  if (t0 >= 0 && t1 >= 0) return Math.max(t0, t1)
  if (t0 >= 0) return t0
  if (t1 >= 0) return t1
  return 0
}

function applyRasterGradientSpread(value: number, spread: 'pad' | 'reflect' | 'repeat'): number {
  if (spread === 'pad') return clamp01(value)
  let t = value - Math.floor(value)
  if (spread === 'repeat') return t
  const cycle = Math.floor(value)
  if (cycle % 2 !== 0) t = 1 - t
  return t
}

function sampleRasterGradientStops(stops: RasterGradientStop[], offset: number): RasterGradientStop {
  if (offset <= stops[0]!.offset) return stops[0]!
  const last = stops[stops.length - 1]!
  if (offset >= last.offset) return last
  for (let i = 1; i < stops.length; i++) {
    const right = stops[i]!
    if (offset > right.offset) continue
    const left = stops[i - 1]!
    const span = right.offset - left.offset
    if (span <= 1e-12) return right
    const t = (offset - left.offset) / span
    return {
      offset,
      r: left.r + (right.r - left.r) * t,
      g: left.g + (right.g - left.g) * t,
      b: left.b + (right.b - left.b) * t,
      a: left.a + (right.a - left.a) * t,
    }
  }
  return last
}

function createRasterContext2D(width: number, height: number): Raster2DContext | null {
  if (!(width > 0) || !(height > 0)) return null
  return new SoftwareRasterContext(width, height)
}

function blendAlphaPixel(
  alpha: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  srcAlpha: number,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const sa = clamp01(srcAlpha)
  if (sa <= 0) return
  const idx = y * width + x
  const dst = alpha[idx]!
  alpha[idx] = dst + sa * (1 - dst)
}

function fillAlphaSpan(
  alpha: Float32Array,
  width: number,
  height: number,
  y: number,
  x0: number,
  x1: number,
  srcAlpha: number,
): void {
  if (y < 0 || y >= height) return
  if (!(x1 > x0)) return
  const start = Math.max(0, Math.ceil(x0 - 0.5))
  const end = Math.min(width - 1, Math.floor(x1 - 0.5))
  if (start > end) return
  const sa = clamp01(srcAlpha)
  if (sa <= 0) return
  const row = y * width
  for (let x = start; x <= end; x++) {
    const idx = row + x
    const dst = alpha[idx]!
    alpha[idx] = dst + sa * (1 - dst)
  }
}

function flattenRasterPath(
  commands: number[] | Uint8Array,
  coords: number[] | Float32Array,
  tolerance: number,
): RasterSubpath[] {
  const out: RasterSubpath[] = []
  let points: RasterPoint[] = []
  let closed = false
  let ci = 0
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let hasCurrent = false

  const pushSubpath = (): void => {
    if (points.length > 0) {
      out.push({ points, closed })
    }
    points = []
    closed = false
  }

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    switch (cmd) {
      case 0: {
        const x = coords[ci]!
        const y = coords[ci + 1]!
        ci += 2
        if (points.length > 0) pushSubpath()
        points.push({ x, y })
        cx = x
        cy = y
        sx = x
        sy = y
        hasCurrent = true
        break
      }
      case 1: {
        if (!hasCurrent || ci + 1 >= coords.length) break
        const x = coords[ci]!
        const y = coords[ci + 1]!
        ci += 2
        points.push({ x, y })
        cx = x
        cy = y
        break
      }
      case 2: {
        if (!hasCurrent || ci + 5 >= coords.length) break
        const p0 = { x: cx, y: cy }
        const p1 = { x: coords[ci]!, y: coords[ci + 1]! }
        const p2 = { x: coords[ci + 2]!, y: coords[ci + 3]! }
        const p3 = { x: coords[ci + 4]!, y: coords[ci + 5]! }
        ci += 6
        flattenCubicSegment(p0, p1, p2, p3, tolerance, points, 0)
        cx = p3.x
        cy = p3.y
        break
      }
      case 3: {
        closed = true
        cx = sx
        cy = sy
        break
      }
      default:
        break
    }
  }
  if (points.length > 0) pushSubpath()
  return out
}

function flattenCubicSegment(
  p0: RasterPoint,
  p1: RasterPoint,
  p2: RasterPoint,
  p3: RasterPoint,
  tolerance: number,
  out: RasterPoint[],
  depth: number,
): void {
  const flat = cubicFlatness(p0, p1, p2, p3)
  if (flat <= tolerance || depth >= 12) {
    out.push({ x: p3.x, y: p3.y })
    return
  }
  const p01 = midpoint(p0, p1)
  const p12 = midpoint(p1, p2)
  const p23 = midpoint(p2, p3)
  const p012 = midpoint(p01, p12)
  const p123 = midpoint(p12, p23)
  const p0123 = midpoint(p012, p123)
  flattenCubicSegment(p0, p01, p012, p0123, tolerance, out, depth + 1)
  flattenCubicSegment(p0123, p123, p23, p3, tolerance, out, depth + 1)
}

function midpoint(a: RasterPoint, b: RasterPoint): RasterPoint {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }
}

function cubicFlatness(p0: RasterPoint, p1: RasterPoint, p2: RasterPoint, p3: RasterPoint): number {
  const d1 = pointToLineDistance(p1, p0, p3)
  const d2 = pointToLineDistance(p2, p0, p3)
  return Math.max(d1, d2)
}

function pointToLineDistance(p: RasterPoint, a: RasterPoint, b: RasterPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  const px = a.x + t * dx
  const py = a.y + t * dy
  return Math.hypot(p.x - px, p.y - py)
}

function rasterFill(
  alpha: Float32Array,
  width: number,
  height: number,
  subpaths: RasterSubpath[],
  fillRule: 'nonzero' | 'evenodd',
  srcAlpha: number,
): void {
  const edges: { x0: number, y0: number, x1: number, y1: number, w: number }[] = []
  for (let si = 0; si < subpaths.length; si++) {
    const sp = subpaths[si]!
    if (sp.points.length < 2) continue
    for (let i = 0; i + 1 < sp.points.length; i++) {
      const a = sp.points[i]!
      const b = sp.points[i + 1]!
      if (Math.abs(a.y - b.y) <= 1e-9) continue
      edges.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, w: a.y < b.y ? 1 : -1 })
    }
    const first = sp.points[0]!
    const last = sp.points[sp.points.length - 1]!
    if (sp.closed || sp.points.length >= 3) {
      if (Math.abs(last.y - first.y) > 1e-9) {
        edges.push({ x0: last.x, y0: last.y, x1: first.x, y1: first.y, w: last.y < first.y ? 1 : -1 })
      }
    }
  }
  if (edges.length === 0) return

  for (let y = 0; y < height; y++) {
    const py = y + 0.5
    const events: { x: number, w: number }[] = []
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei]!
      const minY = Math.min(e.y0, e.y1)
      const maxY = Math.max(e.y0, e.y1)
      if (py < minY || py >= maxY) continue
      const t = (py - e.y0) / (e.y1 - e.y0)
      const x = e.x0 + t * (e.x1 - e.x0)
      events.push({ x, w: e.w })
    }
    if (events.length === 0) continue
    events.sort((a, b) => a.x - b.x)

    if (fillRule === 'evenodd') {
      for (let i = 0; i + 1 < events.length; i += 2) {
        fillAlphaSpan(alpha, width, height, y, events[i]!.x, events[i + 1]!.x, srcAlpha)
      }
      continue
    }

    let winding = 0
    let prevX = 0
    let hasPrev = false
    for (let i = 0; i < events.length;) {
      const x = events[i]!.x
      if (hasPrev && winding !== 0) {
        fillAlphaSpan(alpha, width, height, y, prevX, x, srcAlpha)
      }
      while (i < events.length && Math.abs(events[i]!.x - x) <= 1e-9) {
        winding += events[i]!.w
        i++
      }
      prevX = x
      hasPrev = true
    }
  }
}

function rasterStroke(
  alpha: Float32Array,
  width: number,
  height: number,
  subpaths: RasterSubpath[],
  lineWidth: number,
  lineCap: RasterLineCap,
  lineJoin: RasterLineJoin,
  _miterLimit: number,
  lineDash: number[],
  lineDashOffset: number,
  srcAlpha: number,
): void {
  const half = lineWidth * 0.5
  if (!(half > 0)) return
  const hasDash = lineDash.length > 0

  for (let si = 0; si < subpaths.length; si++) {
    const sp = subpaths[si]!
    if (sp.points.length < 2) continue

    const rawSegments = buildSubpathSegments(sp)
    if (rawSegments.length === 0) continue
    const segments = hasDash
      ? dashStrokeSegments(rawSegments, lineDash, lineDashOffset)
      : rawSegments

    for (let i = 0; i < segments.length; i++) {
      rasterStrokeSegment(alpha, width, height, segments[i]!, half, lineCap, srcAlpha)
    }

    if (!hasDash && sp.points.length >= 3 && lineJoin !== 'bevel') {
      const end = sp.closed ? sp.points.length : sp.points.length - 1
      for (let i = 1; i < end; i++) {
        const p = sp.points[i]!
        rasterDisk(alpha, width, height, p.x, p.y, half, srcAlpha)
      }
    }
  }
}

function buildSubpathSegments(subpath: RasterSubpath): RasterStrokeSegment[] {
  const segments: RasterStrokeSegment[] = []
  for (let i = 0; i + 1 < subpath.points.length; i++) {
    const p0 = subpath.points[i]!
    const p1 = subpath.points[i + 1]!
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) <= 1e-9) continue
    segments.push({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y })
  }
  if (subpath.closed) {
    const p0 = subpath.points[subpath.points.length - 1]!
    const p1 = subpath.points[0]!
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1e-9) {
      segments.push({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y })
    }
  }
  return segments
}

function dashStrokeSegments(
  segments: RasterStrokeSegment[],
  dash: number[],
  dashOffset: number,
): RasterStrokeSegment[] {
  const cleaned = dash.filter(v => Number.isFinite(v) && v > 1e-6)
  if (cleaned.length === 0) return segments
  const pattern = cleaned.length % 2 === 1 ? cleaned.concat(cleaned) : cleaned
  let patternLen = 0
  for (let i = 0; i < pattern.length; i++) patternLen += pattern[i]!
  if (!(patternLen > 1e-6)) return segments

  let offset = dashOffset % patternLen
  if (offset < 0) offset += patternLen
  let pi = 0
  while (offset > pattern[pi]!) {
    offset -= pattern[pi]!
    pi = (pi + 1) % pattern.length
  }
  let draw = (pi % 2) === 0
  let remain = pattern[pi]! - offset

  const out: RasterStrokeSegment[] = []
  for (let si = 0; si < segments.length; si++) {
    const s = segments[si]!
    const dx = s.x1 - s.x0
    const dy = s.y1 - s.y0
    const len = Math.hypot(dx, dy)
    if (len <= 1e-9) continue
    let pos = 0
    while (pos < len - 1e-9) {
      const step = Math.min(remain, len - pos)
      if (draw && step > 1e-9) {
        const t0 = pos / len
        const t1 = (pos + step) / len
        out.push({
          x0: s.x0 + dx * t0,
          y0: s.y0 + dy * t0,
          x1: s.x0 + dx * t1,
          y1: s.y0 + dy * t1,
        })
      }
      pos += step
      if (Math.abs(step - remain) <= 1e-9) {
        pi = (pi + 1) % pattern.length
        draw = (pi % 2) === 0
        remain = pattern[pi]!
      } else {
        remain -= step
      }
    }
  }
  return out
}

function rasterStrokeSegment(
  alpha: Float32Array,
  width: number,
  height: number,
  seg: RasterStrokeSegment,
  half: number,
  lineCap: RasterLineCap,
  srcAlpha: number,
): void {
  const dx = seg.x1 - seg.x0
  const dy = seg.y1 - seg.y0
  const len2 = dx * dx + dy * dy
  const len = Math.sqrt(len2)
  if (len <= 1e-9) {
    rasterDisk(alpha, width, height, seg.x0, seg.y0, half, srcAlpha)
    return
  }

  const ext = lineCap === 'square' ? half : 0
  const ux = dx / len
  const uy = dy / len
  const ex0 = seg.x0 - ux * ext
  const ey0 = seg.y0 - uy * ext
  const ex1 = seg.x1 + ux * ext
  const ey1 = seg.y1 + uy * ext

  const minX = Math.floor(Math.min(ex0, ex1) - half - 1)
  const minY = Math.floor(Math.min(ey0, ey1) - half - 1)
  const maxX = Math.ceil(Math.max(ex0, ex1) + half + 1)
  const maxY = Math.ceil(Math.max(ey0, ey1) + half + 1)

  const r2 = half * half
  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= height) continue
    const cy = y + 0.5
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || x >= width) continue
      const cx = x + 0.5
      const d2 = distanceSqToSegmentCap(cx, cy, seg.x0, seg.y0, seg.x1, seg.y1, lineCap, half)
      if (d2 <= r2) {
        blendAlphaPixel(alpha, width, height, x, y, srcAlpha)
      }
    }
  }
}

function distanceSqToSegmentCap(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lineCap: RasterLineCap,
  half = 0,
): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-12) return (px - x0) ** 2 + (py - y0) ** 2
  const len = Math.sqrt(len2)
  const ux = dx / len
  const uy = dy / len
  const proj = (px - x0) * ux + (py - y0) * uy
  const perp = (px - x0) * (-uy) + (py - y0) * ux

  if (lineCap === 'butt') {
    if (proj < 0 || proj > len) return Number.POSITIVE_INFINITY
    return perp * perp
  }
  if (lineCap === 'square') {
    if (proj < -half || proj > len + half) return Number.POSITIVE_INFINITY
    return perp * perp
  }

  if (proj < 0) return (px - x0) ** 2 + (py - y0) ** 2
  if (proj > len) return (px - x1) ** 2 + (py - y1) ** 2
  return perp * perp
}

function rasterDisk(
  alpha: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  r: number,
  srcAlpha: number,
): void {
  const minX = Math.floor(cx - r - 1)
  const maxX = Math.ceil(cx + r + 1)
  const minY = Math.floor(cy - r - 1)
  const maxY = Math.ceil(cy + r + 1)
  const r2 = r * r
  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= height) continue
    const py = y + 0.5
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || x >= width) continue
      const px = x + 0.5
      const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy)
      if (d2 <= r2) {
        blendAlphaPixel(alpha, width, height, x, y, srcAlpha)
      }
    }
  }
}

function renderDropShadowRaster(
  node: SvgNode,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
  shadowMetrics: { dx: number, dy: number, stdDeviationX: number, stdDeviationY: number },
  filter: SvgDropShadowFilter,
  filterRegion: PathData | null,
  blurSigmaX: number,
  blurSigmaY: number,
): boolean {
  if (!ctx.backend.drawImageData) return false
  if (!filterRegion) return false

  const regionBounds = computeCoordBounds(filterRegion.coords)
  if (!regionBounds) return false
  const minX = Math.floor(regionBounds.minX)
  const minY = Math.floor(regionBounds.minY)
  const maxX = Math.ceil(regionBounds.maxX)
  const maxY = Math.ceil(regionBounds.maxY)
  const width = maxX - minX
  const height = maxY - minY
  if (!(width > 0) || !(height > 0)) return false

  // Fortoptop.area as, with error.
  
  if (width * height > 12_000_000) return false

  const raster = createRasterContext2D(width, height)
  if (!raster) return false

  raster.clearRect(0, 0, width, height)
  drawShadowSourceAlphaNode(node, { ...style, opacity: 1 }, matrix, ctx, raster, minX, minY, true)

  const imageData = raster.getImageData(0, 0, width, height)
  const sourceAlpha = alphaFromImageData(imageData.data)
  let shadowAlpha = blurAlphaChannel(sourceAlpha, width, height, blurSigmaX, blurSigmaY)

  // Dx/dy applytargetcoordinate with,.
  // Targetconvert + viewport convert with coordinate to.


  const offsetX = (matrix[0] * shadowMetrics.dx + matrix[2] * shadowMetrics.dy) * ctx.scaleX
  const offsetY = (matrix[1] * shadowMetrics.dx + matrix[3] * shadowMetrics.dy) * ctx.scaleY
  shadowAlpha = offsetAlphaChannel(shadowAlpha, width, height, offsetX, offsetY)

  const c = filter.color ?? { r: 0, g: 0, b: 0 }
  const filterOpacity = clamp01(filter.opacity)
  const rgba = new Uint8Array(width * height * 4)
  let hasVisible = false
  for (let i = 0; i < shadowAlpha.length; i++) {
    const a = clamp01(shadowAlpha[i]! * filterOpacity)
    const ai = Math.round(a * 255)
    const p = i * 4
    rgba[p] = c.r
    rgba[p + 1] = c.g
    rgba[p + 2] = c.b
    rgba[p + 3] = ai
    if (ai > 0) hasVisible = true
  }
  if (!hasVisible) return true

  const png = encodePngRgba(width, height, rgba)
  ctx.backend.drawImageData(minX, minY, width, height, png, 'image/png')
  return true
}

function renderFilterGraphRaster(
  node: SvgNode,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
  filter: SvgFilterGraph,
): void {
  if (!ctx.backend.drawImageData) throw new Error(`SVG filter "${filter.id}" requires backend image-data rendering`)
  const filterRegion = resolveFilterRegionPath(node, filter, matrix, ctx, style)
  if (!filterRegion) return
  const bounds = computeCoordBounds(filterRegion.coords)
  if (!bounds) return
  const minX = Math.floor(bounds.minX)
  const minY = Math.floor(bounds.minY)
  const width = Math.ceil(bounds.maxX) - minX
  const height = Math.ceil(bounds.maxY) - minY
  if (!(width > 0) || !(height > 0)) return
  const filterResolution = resolveFilterResolution(filter, width, height)
  if (filterResolution.width === 0 || filterResolution.height === 0) return
  if (Math.max(width * height, filterResolution.width * filterResolution.height) > 12_000_000) throw new Error(`SVG filter "${filter.id}" region exceeds the raster limit`)

  const raster = createRasterContext2D(width, height)
  if (!raster) return
  raster.clearRect(0, 0, width, height)
  drawShadowSourceAlphaNode(node, { ...style, opacity: 1 }, matrix, ctx, raster, minX, minY, true)
  const deviceSource = raster.getImageData(0, 0, width, height).data
  const deviceFillPaint = rasterizeFilterPaintInput(node, style, matrix, ctx, width, height, minX, minY, 'fill')
  const deviceStrokePaint = rasterizeFilterPaintInput(node, style, matrix, ctx, width, height, minX, minY, 'stroke')
  const source = filterResolution.width === width && filterResolution.height === height
    ? deviceSource
    : resamplePremultipliedRgba(deviceSource, width, height, filterResolution.width, filterResolution.height)
  const fillPaint = filterResolution.width === width && filterResolution.height === height
    ? deviceFillPaint
    : resamplePremultipliedRgba(deviceFillPaint, width, height, filterResolution.width, filterResolution.height)
  const strokePaint = filterResolution.width === width && filterResolution.height === height
    ? deviceStrokePaint
    : resamplePremultipliedRgba(deviceStrokePaint, width, height, filterResolution.width, filterResolution.height)
  const resolutionScaleX = filterResolution.width / width
  const resolutionScaleY = filterResolution.height / height
  let primitiveScaleX = approxRenderScaleX(matrix, ctx) * resolutionScaleX
  let primitiveScaleY = approxRenderScaleY(matrix, ctx) * resolutionScaleY
  if (filter.primitiveUnits === 'objectBoundingBox') {
    const objectBounds = computeRenderedNodePaintBounds(node, style, matrix)
    if (objectBounds) {
      primitiveScaleX = ctx.scaleX * objectBounds.width * resolutionScaleX
      primitiveScaleY = ctx.scaleY * objectBounds.height * resolutionScaleY
    }
  }
  const primitiveTransform = resolveFilterPrimitiveTransform(
    filter,
    node,
    style,
    matrix,
    ctx,
    minX,
    minY,
  )
  primitiveTransform[0] *= resolutionScaleX
  primitiveTransform[2] *= resolutionScaleX
  primitiveTransform[4] *= resolutionScaleX
  primitiveTransform[1] *= resolutionScaleY
  primitiveTransform[3] *= resolutionScaleY
  primitiveTransform[5] *= resolutionScaleY
  const rgba = executeSvgFilterGraph(
    filter,
    source,
    filterResolution.width,
    filterResolution.height,
    primitiveScaleX,
    primitiveScaleY,
    ctx.paletteFont,
    {
      primitiveTransform,
      percentageReferenceWidth: filter.primitiveUnits === 'objectBoundingBox' ? 1 : ctx.userViewportWidth,
      percentageReferenceHeight: filter.primitiveUnits === 'objectBoundingBox' ? 1 : ctx.userViewportHeight,
    },
    {
      fillPaint,
      strokePaint,
      imageReferences: rasterizeFilterImageReferences(filter, primitiveTransform, ctx, filterResolution.width, filterResolution.height),
      imageResources: ctx.imageResources,
    },
  )
  ctx.backend.save()
  ctx.backend.clipPath(filterRegion.commands, filterRegion.coords, 'nonzero')
  ctx.backend.drawImageData(minX, minY, width, height, encodePngRgba(filterResolution.width, filterResolution.height, rgba), 'image/png')
  ctx.backend.restore()
}

function rasterizeFilterPaintInput(
  node: SvgNode,
  style: SvgStyle,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  width: number,
  height: number,
  originX: number,
  originY: number,
  kind: 'fill' | 'stroke',
): Uint8ClampedArray {
  const raster = createRasterContext2D(width, height)
  if (!raster) throw new Error('SVG filter paint input requires a raster context')
  const localPath = collectLocalNodePath(node)
  let geometry: PathData | null = localPath
  let paintMatrix = matrix
  if (!geometry) {
    geometry = collectNodeGeometryCore(node, matrix)
    paintMatrix = [1, 0, 0, 1, 0, 0]
  }
  if (!geometry) return raster.getImageData(0, 0, width, height).data
  const target = transformCoords(geometry.commands, geometry.coords, paintMatrix, ctx)
  const paints = resolvePathPaintOptions(style, ctx.defs, geometry.commands, geometry.coords, paintMatrix, ctx)
  const paint = kind === 'fill' ? paints.fill : paints.stroke
  const patternId = resolvePatternId(kind === 'fill' ? style.fill : style.stroke, ctx.defs)
  if (!paint && patternId === null) return raster.getImageData(0, 0, width, height).data

  raster.beginPath()
  raster.moveTo(0, 0)
  raster.lineTo(width, 0)
  raster.lineTo(width, height)
  raster.lineTo(0, height)
  raster.closePath()
  raster.globalAlpha = clamp01(kind === 'fill' ? paints.fillOpacity ?? 1 : paints.strokeOpacity ?? 1)
  if (patternId !== null && raster.fillWithRaster) {
    const pattern = rasterizeFilterSourcePattern(patternId, target.coords, paintMatrix, ctx, width, height, originX, originY)
    if (pattern) raster.fillWithRaster(pattern)
  } else if (typeof paint === 'string') {
    raster.fillStyle = paint
    raster.fill()
  } else if (isGradientPaint(paint) && raster.fillWithPaint) {
    raster.fillWithPaint(paint, originX, originY)
  }
  return raster.getImageData(0, 0, width, height).data
}

function rasterizeFilterImageReferences(
  filter: SvgFilterGraph,
  primitiveTransform: SvgMatrix,
  ctx: SvgRenderContext,
  width: number,
  height: number,
): ReadonlyMap<string, Uint8ClampedArray> | undefined {
  let result: Map<string, Uint8ClampedArray> | undefined
  for (let i = 0; i < filter.primitives.length; i++) {
    const primitive = filter.primitives[i]!
    if (primitive.type !== 'feImage') continue
    const href = primitive.attributes.href ?? primitive.attributes['xlink:href'] ?? ''
    if (!href.startsWith('#')) continue
    const node = ctx.defs.references.get(href.slice(1))
    if (node === undefined) continue
    const cycleKey = `${filter.id}:${href}`
    if (ctx.filterReferenceStack.includes(cycleKey)) throw new Error(`SVG filter image reference cycle at "${href}"`)
    ctx.filterReferenceStack.push(cycleKey)
    const raster = createRasterContext2D(width, height)
    if (!raster) throw new Error('SVG filter image reference requires a raster context')
    let matrix = primitiveTransform
    if (node.transform) matrix = multiplyMatrix(matrix, node.transform)
    const referenceContext: SvgRenderContext = {
      ...ctx,
      scaleX: 1,
      scaleY: 1,
      translateX: 0,
      translateY: 0,
    }
    drawShadowSourceAlphaNode(node, mergeStyle({}, node.style), matrix, referenceContext, raster, 0, 0)
    ctx.filterReferenceStack.pop()
    if (result === undefined) result = new Map()
    result.set(href, raster.getImageData(0, 0, width, height).data)
  }
  return result
}

function resolveFilterResolution(filter: SvgFilterGraph, width: number, height: number): { width: number, height: number } {
  const raw = filter.attributes.filterRes
  if (raw === undefined) return { width, height }
  const values = raw.trim().split(/[\s,]+/).filter(Boolean).map(Number)
  if (values.length < 1 || values.length > 2 || !values.every(Number.isFinite)) throw new Error(`SVG filter "${filter.id}" has an invalid filterRes`)
  const x = Math.trunc(values[0]!)
  const y = Math.trunc(values[1] ?? values[0]!)
  if (x < 0 || y < 0) throw new Error(`SVG filter "${filter.id}" has a negative filterRes`)
  return { width: x, height: y }
}

function resamplePremultipliedRgba(
  source: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = (x + 0.5) * sourceWidth / width - 0.5
    const sourceY = (y + 0.5) * sourceHeight / height - 0.5
    const x0 = Math.floor(sourceX)
    const y0 = Math.floor(sourceY)
    const tx = sourceX - x0
    const ty = sourceY - y0
    const target = (y * width + x) * 4
    let alpha = 0
    const premultiplied = [0, 0, 0]
    for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
      const sx = Math.max(0, Math.min(sourceWidth - 1, x0 + xx))
      const sy = Math.max(0, Math.min(sourceHeight - 1, y0 + yy))
      const weight = (xx === 0 ? 1 - tx : tx) * (yy === 0 ? 1 - ty : ty)
      const offset = (sy * sourceWidth + sx) * 4
      const sampleAlpha = source[offset + 3]! / 255
      alpha += sampleAlpha * weight
      for (let c = 0; c < 3; c++) premultiplied[c]! += source[offset + c]! / 255 * sampleAlpha * weight
    }
    if (alpha > 1e-9) for (let c = 0; c < 3; c++) out[target + c] = Math.round(premultiplied[c]! / alpha * 255)
    out[target + 3] = Math.round(alpha * 255)
  }
  return out
}

function drawShadowSourceAlphaNode(
  node: SvgNode,
  effectiveStyle: SvgStyle,
  matrix: SvgMatrix,
  svgCtx: SvgRenderContext,
  raster: Raster2DContext,
  originX: number,
  originY: number,
  suppressOwnEffects = false,
  backgroundEnabled = false,
  backgroundRegion?: PathData,
): void {
  if (effectiveStyle.display === 'none' || effectiveStyle.visibility === 'hidden') return

  const opacity = suppressOwnEffects ? 1 : clamp01(effectiveStyle.opacity ?? 1)
  if (opacity <= 0) return
  if (!suppressOwnEffects && (opacity < 1 || node.clipPathId !== undefined || node.maskId !== undefined || node.filterId !== undefined || node.viewportClip !== undefined)) {
    const layer = createRasterContext2D(raster.canvas.width, raster.canvas.height)
    if (!layer || !layer.snapshotPremultiplied || !raster.compositePremultiplied) {
      throw new Error('SVG filter source effects require premultiplied raster compositing')
    }
    let backdrop = backgroundEnabled && raster.snapshotPremultiplied ? raster.snapshotPremultiplied() : undefined
    if (backdrop && backgroundRegion) {
      backdrop = maskRasterByPath(backdrop, backgroundRegion, originX, originY, raster.canvas.width, raster.canvas.height)
    }
    drawShadowSourceAlphaNode(node, { ...effectiveStyle, opacity: 1 }, matrix, svgCtx, layer, originX, originY, true, backgroundEnabled, backgroundRegion)
    let pixels = layer.snapshotPremultiplied()
    if (node.filterId) pixels = applyFilterToRasterLayer(node, effectiveStyle, matrix, svgCtx, pixels, backdrop, originX, originY, raster.canvas.width, raster.canvas.height)
    if (node.clipPathId) pixels = applyClipPathToRasterLayer(node, effectiveStyle, matrix, svgCtx, pixels, originX, originY, raster.canvas.width, raster.canvas.height)
    if (node.viewportClip) pixels = maskRasterByPath(pixels, resolveNodeViewportClip(node, matrix, svgCtx)!, originX, originY, raster.canvas.width, raster.canvas.height)
    if (node.maskId) pixels = applyMaskToRasterLayer(node, effectiveStyle, matrix, svgCtx, pixels, originX, originY, raster.canvas.width, raster.canvas.height)
    raster.compositePremultiplied(pixels, opacity)
    return
  }

  if (node.type === 'g') {
    const enableBackground = parseEnableBackground(effectiveStyle.enableBackground)
    const startsBackground = enableBackground.mode === 'new'
    const childBackgroundRegion = startsBackground
      ? resolveEnableBackgroundRegion(enableBackground, matrix, svgCtx)
      : backgroundRegion
    let childRaster = raster
    if (startsBackground) {
      const isolatedRaster = createRasterContext2D(raster.canvas.width, raster.canvas.height)
      if (!isolatedRaster || !isolatedRaster.snapshotPremultiplied || !raster.compositePremultiplied) {
        throw new Error('SVG enable-background requires premultiplied raster compositing')
      }
      childRaster = isolatedRaster
    }
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!
      const childStyle = mergeStyle(effectiveStyle, child.style)
      let childMatrix = matrix
      if (child.transform) {
        childMatrix = multiplyMatrix(matrix, child.transform)
      }
      drawShadowSourceAlphaNode(child, childStyle, childMatrix, svgCtx, childRaster, originX, originY, false, backgroundEnabled || startsBackground, childBackgroundRegion)
    }
    if (startsBackground) raster.compositePremultiplied!(childRaster.snapshotPremultiplied!())
    return
  }
  if (node.type === 'text') return
  if (node.type === 'image') {
    drawFilterSourceImage(node, matrix, svgCtx, raster, originX, originY)
    return
  }

  const localPath = collectLocalNodePath(node)
  if (!localPath) return
  const transformed = transformCoords(localPath.commands, localPath.coords, matrix, svgCtx)
  const paints = resolvePathPaintOptions(effectiveStyle, svgCtx.defs, localPath.commands, localPath.coords, matrix, svgCtx)
  const fillPatternId = resolvePatternId(effectiveStyle.fill, svgCtx.defs)
  const elementOpacity = 1

  const fillAlpha = (paints.fill || fillPatternId !== null)
    ? clamp01((paints.fillOpacity ?? 1) * elementOpacity)
    : 0
  const strokeWidth = paints.strokeWidth ?? 0
  const strokeAlpha = (paints.stroke && strokeWidth > 0)
    ? clamp01((paints.strokeOpacity ?? 1) * elementOpacity)
    : 0
  const hasMarkers = effectiveStyle.markerStart !== undefined || effectiveStyle.markerMid !== undefined || effectiveStyle.markerEnd !== undefined
  if (fillAlpha <= 0 && strokeAlpha <= 0 && !hasMarkers) return

  if (fillAlpha > 0 || strokeAlpha > 0) {
    raster.save()
    traceRasterPath(raster, transformed.commands, transformed.coords, originX, originY)

    if (fillAlpha > 0) {
      raster.globalAlpha = fillAlpha
      if (fillPatternId !== null && raster.fillWithRaster) {
        const patternSource = rasterizeFilterSourcePattern(
          fillPatternId, transformed.coords, matrix, svgCtx, raster.canvas.width, raster.canvas.height, originX, originY,
        )
        if (patternSource !== null) raster.fillWithRaster(patternSource, paints.fillRule ?? 'nonzero')
      } else if (typeof paints.fill === 'string') {
        raster.fillStyle = paints.fill
        raster.fill(paints.fillRule ?? 'nonzero')
      } else if (isGradientPaint(paints.fill) && raster.fillWithPaint) {
        raster.fillWithPaint(paints.fill, originX, originY, paints.fillRule ?? 'nonzero')
      }
    }

    if (strokeAlpha > 0 && strokeWidth > 0) {
      raster.globalAlpha = strokeAlpha
      raster.lineWidth = strokeWidth
      raster.lineCap = paints.strokeLinecap ?? 'butt'
      raster.lineJoin = paints.strokeLinejoin ?? 'miter'
      raster.miterLimit = paints.strokeMiterLimit ?? 4
      if (typeof raster.setLineDash === 'function') {
        raster.setLineDash(paints.strokeDasharray && paints.strokeDasharray.length > 0 ? paints.strokeDasharray : [])
      }
      raster.lineDashOffset = paints.strokeDashoffset ?? 0
      if (typeof paints.stroke === 'string') {
        raster.strokeStyle = paints.stroke
        raster.stroke()
      } else if (isGradientPaint(paints.stroke) && raster.strokeWithPaint) {
        raster.strokeWithPaint(paints.stroke, originX, originY)
      }
    }

    raster.restore()
  }
  if (hasMarkers) drawRasterMarkersForPath(localPath.commands, localPath.coords, effectiveStyle, matrix, svgCtx, raster, originX, originY, backgroundEnabled, backgroundRegion)
}

function drawRasterMarkersForPath(
  commands: Uint8Array,
  coords: Float32Array,
  style: SvgStyle,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  raster: Raster2DContext,
  originX: number,
  originY: number,
  backgroundEnabled: boolean,
  backgroundRegion: PathData | undefined,
): void {
  const subpaths = extractPathSubpaths(commands, coords)
  for (let i = 0; i < subpaths.length; i++) {
    const subpath = subpaths[i]!
    if (subpath.points.length === 0) continue
    if (style.markerStart) {
      const point = subpath.points[0]!
      drawRasterMarkerInstance(style.markerStart, point, resolveMarkerAngle(point, 'start'), true, style, matrix, ctx, raster, originX, originY, backgroundEnabled, backgroundRegion)
    }
    if (style.markerMid && subpath.points.length > 1) {
      const end = subpath.closed ? subpath.points.length : subpath.points.length - 1
      for (let pointIndex = 1; pointIndex < end; pointIndex++) {
        const point = subpath.points[pointIndex]!
        drawRasterMarkerInstance(style.markerMid, point, resolveMarkerAngle(point, 'mid'), false, style, matrix, ctx, raster, originX, originY, backgroundEnabled, backgroundRegion)
      }
    }
    if (style.markerEnd && subpath.points.length > 1) {
      const point = subpath.closed ? subpath.points[0]! : subpath.points[subpath.points.length - 1]!
      drawRasterMarkerInstance(style.markerEnd, point, resolveMarkerAngle(point, 'end'), false, style, matrix, ctx, raster, originX, originY, backgroundEnabled, backgroundRegion)
    }
  }
}

function drawRasterMarkerInstance(
  markerId: string,
  point: MarkerPoint,
  automaticAngle: number,
  isStart: boolean,
  style: SvgStyle,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  raster: Raster2DContext,
  originX: number,
  originY: number,
  backgroundEnabled: boolean,
  backgroundRegion: PathData | undefined,
): void {
  const marker = ctx.defs.markers.get(markerId)
  if (!marker) return
  let angle = typeof marker.orient === 'number' ? marker.orient : automaticAngle
  if (marker.orient === 'auto-start-reverse' && isStart) angle += 180
  const radians = angle * Math.PI / 180
  const markerScale = marker.markerUnits === 'strokeWidth' ? style.strokeWidth ?? 1 : 1
  let local: SvgMatrix = [1, 0, 0, 1, point.x, point.y]
  local = multiplyMatrix(local, [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0])
  local = multiplyMatrix(local, [markerScale, 0, 0, markerScale, 0, 0])
  let markerViewportClip = marker.overflow === 'hidden'
    ? { x: 0, y: 0, width: marker.markerWidth, height: marker.markerHeight }
    : undefined
  if (marker.viewBox && marker.viewBox.width > 0 && marker.viewBox.height > 0) {
    const fit = computeViewBoxToViewportTransform(marker.viewBox, marker.markerWidth, marker.markerHeight, marker.preserveAspectRatio ?? 'xMidYMid meet')
    const mappedRefX = marker.refX * fit.scaleX + fit.translateX
    const mappedRefY = marker.refY * fit.scaleY + fit.translateY
    local = multiplyMatrix(local, [1, 0, 0, 1, -mappedRefX, -mappedRefY])
    local = multiplyMatrix(local, [fit.scaleX, 0, 0, fit.scaleY, fit.translateX, fit.translateY])
    if (markerViewportClip !== undefined) {
      markerViewportClip = {
        x: -fit.translateX / fit.scaleX,
        y: -fit.translateY / fit.scaleY,
        width: marker.markerWidth / fit.scaleX,
        height: marker.markerHeight / fit.scaleY,
      }
    }
  } else {
    local = multiplyMatrix(local, [1, 0, 0, 1, -marker.refX, -marker.refY])
  }
  const markerMatrix = multiplyMatrix(matrix, local)
  const markerGroup: SvgGroup = { type: 'g', children: marker.children, style: {}, viewportClip: markerViewportClip }
  drawShadowSourceAlphaNode(markerGroup, {}, markerMatrix, ctx, raster, originX, originY, false, backgroundEnabled, backgroundRegion)
}

function applyFilterToRasterLayer(
  node: SvgNode,
  style: SvgStyle,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  source: Float32Array,
  background: Float32Array | undefined,
  originX: number,
  originY: number,
  width: number,
  height: number,
): Float32Array {
  const filter = ctx.defs.filters.get(node.filterId!)
  if (!filter) return source
  const regionPath = resolveFilterRegionPath(node, filter, matrix, ctx, style)
  if (!regionPath) return new Float32Array(source.length)
  if (filter.type === 'drop-shadow') {
    const metrics = resolveFilterShadowMetrics(node, style, matrix, filter)
    const alpha = new Float32Array(width * height)
    for (let i = 0; i < alpha.length; i++) alpha[i] = source[i * 4 + 3]!
    const sigmaX = Math.max(0, metrics.stdDeviationX * approxRenderScaleX(matrix, ctx))
    const sigmaY = Math.max(0, metrics.stdDeviationY * approxRenderScaleY(matrix, ctx))
    let shadow = blurAlphaChannel(alpha, width, height, sigmaX, sigmaY)
    const offsetX = (matrix[0] * metrics.dx + matrix[2] * metrics.dy) * ctx.scaleX
    const offsetY = (matrix[1] * metrics.dx + matrix[3] * metrics.dy) * ctx.scaleY
    shadow = offsetAlphaChannel(shadow, width, height, offsetX, offsetY)
    const out = new Float32Array(source.length)
    const color = filter.color ?? { r: 0, g: 0, b: 0 }
    const filterOpacity = clamp01(filter.opacity)
    for (let i = 0; i < shadow.length; i++) {
      const p = i * 4
      const a = clamp01(shadow[i]! * filterOpacity)
      out[p] = color.r / 255 * a
      out[p + 1] = color.g / 255 * a
      out[p + 2] = color.b / 255 * a
      out[p + 3] = a
    }
    if (filter.includeSourceGraphic) compositeFloatRaster(out, source, 1)
    return maskRasterByPath(out, regionPath, originX, originY, width, height)
  }

  const regionBounds = computeCoordBounds(regionPath.coords)
  if (!regionBounds) return new Float32Array(source.length)
  const minX = Math.max(originX, Math.floor(regionBounds.minX))
  const minY = Math.max(originY, Math.floor(regionBounds.minY))
  const maxX = Math.min(originX + width, Math.ceil(regionBounds.maxX))
  const maxY = Math.min(originY + height, Math.ceil(regionBounds.maxY))
  const regionWidth = maxX - minX
  const regionHeight = maxY - minY
  if (!(regionWidth > 0) || !(regionHeight > 0)) return new Float32Array(source.length)
  const sourceBytes = premultipliedFloatToBytes(source)
  const croppedSource = cropRgba(sourceBytes, width, height, minX - originX, minY - originY, regionWidth, regionHeight)
  const croppedBackground = background
    ? cropRgba(premultipliedFloatToBytes(background), width, height, minX - originX, minY - originY, regionWidth, regionHeight)
    : undefined
  const filterResolution = resolveFilterResolution(filter, regionWidth, regionHeight)
  if (filterResolution.width === 0 || filterResolution.height === 0) return new Float32Array(source.length)
  if (filterResolution.width * filterResolution.height > 12_000_000) throw new Error(`SVG filter "${filter.id}" region exceeds the raster limit`)
  const filterSource = filterResolution.width === regionWidth && filterResolution.height === regionHeight
    ? croppedSource
    : resamplePremultipliedRgba(croppedSource, regionWidth, regionHeight, filterResolution.width, filterResolution.height)
  const backgroundPaint = croppedBackground === undefined
    ? undefined
    : filterResolution.width === regionWidth && filterResolution.height === regionHeight
      ? croppedBackground
      : resamplePremultipliedRgba(croppedBackground, regionWidth, regionHeight, filterResolution.width, filterResolution.height)
  const fillDevice = rasterizeFilterPaintInput(node, style, matrix, ctx, regionWidth, regionHeight, minX, minY, 'fill')
  const strokeDevice = rasterizeFilterPaintInput(node, style, matrix, ctx, regionWidth, regionHeight, minX, minY, 'stroke')
  const fillPaint = filterResolution.width === regionWidth && filterResolution.height === regionHeight
    ? fillDevice
    : resamplePremultipliedRgba(fillDevice, regionWidth, regionHeight, filterResolution.width, filterResolution.height)
  const strokePaint = filterResolution.width === regionWidth && filterResolution.height === regionHeight
    ? strokeDevice
    : resamplePremultipliedRgba(strokeDevice, regionWidth, regionHeight, filterResolution.width, filterResolution.height)
  const resolutionScaleX = filterResolution.width / regionWidth
  const resolutionScaleY = filterResolution.height / regionHeight
  let primitiveScaleX = approxRenderScaleX(matrix, ctx) * resolutionScaleX
  let primitiveScaleY = approxRenderScaleY(matrix, ctx) * resolutionScaleY
  if (filter.primitiveUnits === 'objectBoundingBox') {
    const objectBounds = computeRenderedNodePaintBounds(node, style, matrix)
    if (objectBounds) {
      primitiveScaleX = ctx.scaleX * objectBounds.width * resolutionScaleX
      primitiveScaleY = ctx.scaleY * objectBounds.height * resolutionScaleY
    }
  }
  const primitiveTransform = resolveFilterPrimitiveTransform(filter, node, style, matrix, ctx, minX, minY)
  primitiveTransform[0] *= resolutionScaleX
  primitiveTransform[2] *= resolutionScaleX
  primitiveTransform[4] *= resolutionScaleX
  primitiveTransform[1] *= resolutionScaleY
  primitiveTransform[3] *= resolutionScaleY
  primitiveTransform[5] *= resolutionScaleY
  let result: Uint8Array | Uint8ClampedArray = executeSvgFilterGraph(
    filter,
    filterSource,
    filterResolution.width,
    filterResolution.height,
    primitiveScaleX,
    primitiveScaleY,
    ctx.paletteFont,
    {
      primitiveTransform,
      percentageReferenceWidth: filter.primitiveUnits === 'objectBoundingBox' ? 1 : ctx.userViewportWidth,
      percentageReferenceHeight: filter.primitiveUnits === 'objectBoundingBox' ? 1 : ctx.userViewportHeight,
    },
    {
      background: backgroundPaint,
      fillPaint,
      strokePaint,
      imageReferences: rasterizeFilterImageReferences(filter, primitiveTransform, ctx, filterResolution.width, filterResolution.height),
      imageResources: ctx.imageResources,
    },
  )
  if (filterResolution.width !== regionWidth || filterResolution.height !== regionHeight) {
    result = resamplePremultipliedRgba(result, filterResolution.width, filterResolution.height, regionWidth, regionHeight)
  }
  const out = new Float32Array(source.length)
  pasteRgbaIntoFloat(out, width, height, result, regionWidth, regionHeight, minX - originX, minY - originY)
  return maskRasterByPath(out, regionPath, originX, originY, width, height)
}

function applyClipPathToRasterLayer(
  node: SvgNode,
  style: SvgStyle,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  source: Float32Array,
  originX: number,
  originY: number,
  width: number,
  height: number,
): Float32Array {
  const path = resolveClipPathData(node.clipPathId!, node, ctx, matrix, style)
  return path ? maskRasterByPath(source, path, originX, originY, width, height) : new Float32Array(source.length)
}

function applyMaskToRasterLayer(
  node: SvgNode,
  style: SvgStyle,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  source: Float32Array,
  originX: number,
  originY: number,
  width: number,
  height: number,
): Float32Array {
  const mask = ctx.defs.masks.get(node.maskId!)
  if (!mask) return new Float32Array(source.length)
  let bounds: CoordBounds | null = null
  if (mask.maskUnits === 'objectBoundingBox' || mask.maskContentUnits === 'objectBoundingBox') {
    bounds = computeRenderedNodePaintBounds(node, style, matrix)
    if (!bounds) return new Float32Array(source.length)
  }
  const rawRegion = resolveMaskRegionPath(mask, bounds)
  if (!rawRegion) return new Float32Array(source.length)
  const userRegion = mask.maskUnits === 'userSpaceOnUse'
    ? transformPathByMatrix(rawRegion.commands, rawRegion.coords, matrix)
    : rawRegion
  const region = applyViewportToPathData(userRegion, ctx)
  const maskRaster = createRasterContext2D(width, height)
  if (!maskRaster || !maskRaster.snapshotPremultiplied) throw new Error('SVG mask requires a premultiplied raster context')
  let contentMatrix = matrix
  if (mask.maskContentUnits === 'objectBoundingBox') {
    const box = bounds!
    contentMatrix = [box.width, 0, 0, box.height, box.minX, box.minY]
  }
  for (let i = 0; i < mask.children.length; i++) {
    const child = mask.children[i]!
    let childMatrix = contentMatrix
    if (child.transform) childMatrix = multiplyMatrix(contentMatrix, child.transform)
    drawShadowSourceAlphaNode(child, mergeStyle({}, child.style), childMatrix, ctx, maskRaster, originX, originY)
  }
  const maskPixels = maskRaster.snapshotPremultiplied()
  const regionCoverage = rasterizePathCoverage(region, originX, originY, width, height)
  const out = source.slice()
  for (let i = 0; i < regionCoverage.length; i++) {
    const p = i * 4
    const maskValue = mask.maskType === 'alpha'
      ? maskPixels[p + 3]!
      : 0.2125 * maskPixels[p]! + 0.7154 * maskPixels[p + 1]! + 0.0721 * maskPixels[p + 2]!
    const factor = clamp01(maskValue * regionCoverage[i]!)
    out[p] = out[p]! * factor
    out[p + 1] = out[p + 1]! * factor
    out[p + 2] = out[p + 2]! * factor
    out[p + 3] = out[p + 3]! * factor
  }
  return out
}

function maskRasterByPath(
  source: Float32Array,
  path: PathData,
  originX: number,
  originY: number,
  width: number,
  height: number,
): Float32Array {
  const coverage = rasterizePathCoverage(path, originX, originY, width, height)
  const out = source.slice()
  for (let i = 0; i < coverage.length; i++) {
    const factor = coverage[i]!
    const p = i * 4
    out[p] = out[p]! * factor
    out[p + 1] = out[p + 1]! * factor
    out[p + 2] = out[p + 2]! * factor
    out[p + 3] = out[p + 3]! * factor
  }
  return out
}

function rasterizePathCoverage(path: PathData, originX: number, originY: number, width: number, height: number): Float32Array {
  const local = new Float32Array(path.coords.length)
  for (let i = 0; i < local.length; i += 2) {
    local[i] = path.coords[i]! - originX
    local[i + 1] = path.coords[i + 1]! - originY
  }
  const subpaths = flattenRasterPath(path.commands, local, 0.6)
  const coverage = new Float32Array(width * height)
  rasterFill(coverage, width, height, subpaths, path.fillRule ?? 'nonzero', 1)
  return coverage
}

function premultipliedFloatToBytes(source: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(source.length)
  for (let p = 0; p < source.length; p += 4) {
    const alpha = clamp01(source[p + 3]!)
    if (alpha > 1e-9) {
      out[p] = Math.round(clamp01(source[p]! / alpha) * 255)
      out[p + 1] = Math.round(clamp01(source[p + 1]! / alpha) * 255)
      out[p + 2] = Math.round(clamp01(source[p + 2]! / alpha) * 255)
    }
    out[p + 3] = Math.round(alpha * 255)
  }
  return out
}

function cropRgba(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  if (x < 0 || y < 0 || x + width > sourceWidth || y + height > sourceHeight) throw new Error('SVG raster crop is outside the source')
  const out = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row++) {
    const sourceStart = ((y + row) * sourceWidth + x) * 4
    out.set(source.subarray(sourceStart, sourceStart + width * 4), row * width * 4)
  }
  return out
}

function pasteRgbaIntoFloat(
  destination: Float32Array,
  destinationWidth: number,
  destinationHeight: number,
  source: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
): void {
  if (x < 0 || y < 0 || x + sourceWidth > destinationWidth || y + sourceHeight > destinationHeight) throw new Error('SVG raster paste is outside the destination')
  for (let row = 0; row < sourceHeight; row++) for (let column = 0; column < sourceWidth; column++) {
    const from = (row * sourceWidth + column) * 4
    const to = ((y + row) * destinationWidth + x + column) * 4
    const alpha = source[from + 3]! / 255
    destination[to] = source[from]! / 255 * alpha
    destination[to + 1] = source[from + 1]! / 255 * alpha
    destination[to + 2] = source[from + 2]! / 255 * alpha
    destination[to + 3] = alpha
  }
}

function compositeFloatRaster(destination: Float32Array, source: Float32Array, opacity: number): void {
  const layerOpacity = clamp01(opacity)
  for (let p = 0; p < source.length; p += 4) {
    const alpha = clamp01(source[p + 3]! * layerOpacity)
    if (alpha <= 0) continue
    const inverse = 1 - alpha
    destination[p] = source[p]! * layerOpacity + destination[p]! * inverse
    destination[p + 1] = source[p + 1]! * layerOpacity + destination[p + 1]! * inverse
    destination[p + 2] = source[p + 2]! * layerOpacity + destination[p + 2]! * inverse
    destination[p + 3] = alpha + destination[p + 3]! * inverse
  }
}

function rasterizeFilterSourcePattern(
  patternId: string,
  transformedPathCoords: Float32Array,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  width: number,
  height: number,
  originX: number,
  originY: number,
): Float32Array | null {
  const pattern = ctx.defs.patterns.get(patternId)
  if (pattern === undefined || ctx.patternStack.includes(patternId)) return null
  const bounds = computeCoordBounds(transformedPathCoords)
  if (bounds === null) return null

  let tileX: number
  let tileY: number
  let tileWidth: number
  let tileHeight: number
  if (pattern.patternUnits === 'objectBoundingBox') {
    tileX = bounds.minX + pattern.x * bounds.width
    tileY = bounds.minY + pattern.y * bounds.height
    tileWidth = pattern.width * bounds.width
    tileHeight = pattern.height * bounds.height
  } else {
    const start = transformPoint(pattern.x, pattern.y, matrix, ctx)
    const xEnd = transformPoint(pattern.x + pattern.width, pattern.y, matrix, ctx)
    const yEnd = transformPoint(pattern.x, pattern.y + pattern.height, matrix, ctx)
    tileX = start.x
    tileY = start.y
    tileWidth = Math.hypot(xEnd.x - start.x, xEnd.y - start.y)
    tileHeight = Math.hypot(yEnd.x - start.x, yEnd.y - start.y)
  }
  if (!(tileWidth > 0) || !(tileHeight > 0)) return null

  const patternRaster = createRasterContext2D(width, height)
  if (patternRaster === null || patternRaster.snapshotPremultiplied === undefined) return null
  const startX = tileX + Math.floor((bounds.minX - tileX) / tileWidth) * tileWidth
  const startY = tileY + Math.floor((bounds.minY - tileY) / tileHeight) * tileHeight
  ctx.patternStack.push(patternId)
  let tileCount = 0
  for (let y = startY; y < bounds.maxY + tileHeight * 0.5; y += tileHeight) {
    for (let x = startX; x < bounds.maxX + tileWidth * 0.5; x += tileWidth) {
      if (++tileCount > 4096) throw new Error('SVG pattern exceeds the filter source tile limit')
      let deviceMatrix: SvgMatrix
      if (pattern.viewBox !== undefined) {
        const fit = computeViewBoxToViewportTransform(
          pattern.viewBox, tileWidth, tileHeight, pattern.preserveAspectRatio ?? 'xMidYMid meet',
        )
        deviceMatrix = [fit.scaleX, 0, 0, fit.scaleY, x + fit.translateX, y + fit.translateY]
      } else if (pattern.patternContentUnits === 'objectBoundingBox') {
        deviceMatrix = [bounds.width, 0, 0, bounds.height, x, y]
      } else {
        const renderScale = approxRenderScale(matrix, ctx)
        deviceMatrix = [renderScale, 0, 0, renderScale, x, y]
      }
      if (pattern.patternTransform !== undefined) deviceMatrix = multiplyMatrix(deviceMatrix, pattern.patternTransform)
      const localMatrix = removeViewportTransform(deviceMatrix, ctx)
      for (let i = 0; i < pattern.children.length; i++) {
        const child = pattern.children[i]!
        let childMatrix = localMatrix
        if (child.transform !== undefined) childMatrix = multiplyMatrix(localMatrix, child.transform)
        drawShadowSourceAlphaNode(child, mergeStyle({}, child.style), childMatrix, ctx, patternRaster, originX, originY)
      }
    }
  }
  ctx.patternStack.pop()
  return patternRaster.snapshotPremultiplied()
}

function removeViewportTransform(deviceMatrix: SvgMatrix, ctx: SvgRenderContext): SvgMatrix {
  if (Math.abs(ctx.scaleX) <= 1e-12 || Math.abs(ctx.scaleY) <= 1e-12) {
    throw new Error('SVG viewport transform is singular')
  }
  return [
    deviceMatrix[0] / ctx.scaleX,
    deviceMatrix[1] / ctx.scaleY,
    deviceMatrix[2] / ctx.scaleX,
    deviceMatrix[3] / ctx.scaleY,
    (deviceMatrix[4] - ctx.translateX) / ctx.scaleX,
    (deviceMatrix[5] - ctx.translateY) / ctx.scaleY,
  ]
}

function drawFilterSourceImage(
  node: SvgImage,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  raster: Raster2DContext,
  originX: number,
  originY: number,
): void {
  if (!raster.drawImageRgbaAffine) return
  const embedded = resolveSvgImageResource(node.href, ctx)
  if (!embedded) throw new Error(`SVG filter source image "${node.href}" requires explicit image data`)
  let rgba: Uint8Array
  let sourceWidth: number
  let sourceHeight: number
  if (embedded.mimeType === 'image/png') {
    const decoded = decodePng(embedded.data)
    rgba = decoded.pixels; sourceWidth = decoded.width; sourceHeight = decoded.height
  } else if (embedded.mimeType === 'image/jpeg') {
    const decoded = decodeJpegToRgba(embedded.data)
    rgba = decoded.rgba; sourceWidth = decoded.width; sourceHeight = decoded.height
  } else {
    return
  }
  const box = resolveImageDestBox(node, { width: sourceWidth, height: sourceHeight })
  const p0 = transformPoint(box.x, box.y, matrix, ctx)
  const px = transformPoint(box.x + box.width, box.y, matrix, ctx)
  const py = transformPoint(box.x, box.y + box.height, matrix, ctx)
  raster.drawImageRgbaAffine(rgba, sourceWidth, sourceHeight, [
    px.x - p0.x, px.y - p0.y,
    py.x - p0.x, py.y - p0.y,
    p0.x - originX, p0.y - originY,
  ])
}

function collectLocalNodePath(node: SvgNode): PathData | null {
  switch (node.type) {
    case 'path':
      return { commands: node.commands, coords: node.coords }
    case 'rect': {
      if (node.width <= 0 || node.height <= 0) return null
      if (node.rx > 0 || node.ry > 0) {
        const rr = roundedRectToPath(node.x, node.y, node.width, node.height, node.rx, node.ry)
        return { commands: rr.commands, coords: rr.coords }
      }
      const commands = new Uint8Array([0, 1, 1, 1, 3])
      const coords = new Float32Array([
        node.x, node.y,
        node.x + node.width, node.y,
        node.x + node.width, node.y + node.height,
        node.x, node.y + node.height,
      ])
      return { commands, coords }
    }
    case 'circle':
      if (node.r <= 0) return null
      {
        const [commands, coords] = ellipseToPath(node.cx, node.cy, node.r, node.r)
        return { commands, coords }
      }
    case 'ellipse':
      if (node.rx <= 0 || node.ry <= 0) return null
      {
        const [commands, coords] = ellipseToPath(node.cx, node.cy, node.rx, node.ry)
        return { commands, coords }
      }
    case 'line': {
      const commands = new Uint8Array([0, 1])
      const coords = new Float32Array([node.x1, node.y1, node.x2, node.y2])
      return { commands, coords }
    }
    case 'polyline': {
      if (node.points.length < 4) return null
      const numPoints = node.points.length / 2
      const commands = new Uint8Array(numPoints)
      commands[0] = 0
      for (let i = 1; i < numPoints; i++) commands[i] = 1
      return { commands, coords: node.points }
    }
    case 'polygon': {
      if (node.points.length < 4) return null
      const numPoints = node.points.length / 2
      const commands = new Uint8Array(numPoints + 1)
      commands[0] = 0
      for (let i = 1; i < numPoints; i++) commands[i] = 1
      commands[numPoints] = 3
      return { commands, coords: node.points }
    }
    case 'g':
    case 'text':
    case 'image':
      return null
  }
}

function traceRasterPath(
  raster: Raster2DContext,
  commands: Uint8Array,
  coords: Float32Array,
  originX: number,
  originY: number,
): void {
  raster.beginPath()
  let ci = 0
  for (let i = 0; i < commands.length; i++) {
    switch (commands[i]) {
      case 0:
        raster.moveTo(coords[ci]! - originX, coords[ci + 1]! - originY)
        ci += 2
        break
      case 1:
        raster.lineTo(coords[ci]! - originX, coords[ci + 1]! - originY)
        ci += 2
        break
      case 2:
        raster.bezierCurveTo(
          coords[ci]! - originX, coords[ci + 1]! - originY,
          coords[ci + 2]! - originX, coords[ci + 3]! - originY,
          coords[ci + 4]! - originX, coords[ci + 5]! - originY,
        )
        ci += 6
        break
      case 3:
        raster.closePath()
        break
    }
  }
}

function alphaFromImageData(rgba: Uint8ClampedArray): Float32Array {
  const alpha = new Float32Array(rgba.length >> 2)
  let ai = 0
  for (let i = 0; i < rgba.length; i += 4) {
    alpha[ai++] = rgba[i + 3]! / 255
  }
  return alpha
}

function blurAlphaChannel(
  source: Float32Array,
  width: number,
  height: number,
  sigmaX: number,
  sigmaY: number,
): Float32Array {
  let out = source
  if (sigmaX > 1e-3) {
    const kernelX = buildGaussianKernel1D(sigmaX)
    out = convolveHorizontal(out, width, height, kernelX)
  }
  if (sigmaY > 1e-3) {
    const kernelY = buildGaussianKernel1D(sigmaY)
    out = convolveVertical(out, width, height, kernelY)
  }
  return out
}

function buildGaussianKernel1D(sigma: number): Float32Array {
  const s = Math.max(1e-3, sigma)
  const radius = Math.max(1, Math.ceil(s * 3))
  const kernel = new Float32Array(radius * 2 + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * s * s))
    kernel[i + radius] = w
    sum += w
  }
  if (sum > 0) {
    for (let i = 0; i < kernel.length; i++) kernel[i]! /= sum
  }
  return kernel
}

function convolveHorizontal(
  src: Float32Array,
  width: number,
  height: number,
  kernel: Float32Array,
): Float32Array {
  const out = new Float32Array(src.length)
  const radius = (kernel.length - 1) >> 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k
        if (sx < 0 || sx >= width) continue
        acc += src[row + sx]! * kernel[k + radius]!
      }
      out[row + x] = acc
    }
  }
  return out
}

function convolveVertical(
  src: Float32Array,
  width: number,
  height: number,
  kernel: Float32Array,
): Float32Array {
  const out = new Float32Array(src.length)
  const radius = (kernel.length - 1) >> 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k
        if (sy < 0 || sy >= height) continue
        acc += src[sy * width + x]! * kernel[k + radius]!
      }
      out[y * width + x] = acc
    }
  }
  return out
}

function offsetAlphaChannel(
  src: Float32Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Float32Array {
  if (Math.abs(dx) <= 1e-6 && Math.abs(dy) <= 1e-6) return src
  const out = new Float32Array(src.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = sampleAlphaBilinear(src, width, height, x - dx, y - dy)
    }
  }
  return out
}

function sampleAlphaBilinear(
  src: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = x - x0
  const ty = y - y0
  const x1 = x0 + 1
  const y1 = y0 + 1

  const a00 = (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) ? src[y0 * width + x0]! : 0
  const a10 = (x1 >= 0 && x1 < width && y0 >= 0 && y0 < height) ? src[y0 * width + x1]! : 0
  const a01 = (x0 >= 0 && x0 < width && y1 >= 0 && y1 < height) ? src[y1 * width + x0]! : 0
  const a11 = (x1 >= 0 && x1 < width && y1 >= 0 && y1 < height) ? src[y1 * width + x1]! : 0

  const top = a00 * (1 - tx) + a10 * tx
  const bottom = a01 * (1 - tx) + a11 * tx
  return top * (1 - ty) + bottom * ty
}

// Draw.


function renderPath(
  commands: Uint8Array,
  coords: Float32Array,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
  rawPathData?: string,
): void {
  if (commands.length === 0) return

  // Coordinateconvert apply.
  
  const transformed = transformCoords(commands, coords, matrix, ctx)
  const fillPatternId = resolvePatternId(style.fill, ctx.defs)
  if (fillPatternId) {
    renderPatternFillPath(
      fillPatternId,
      transformed.commands,
      transformed.coords,
      style.fillRule ?? 'nonzero',
      ctx,
      matrix,
    )
  }

  const styleForDirectPaint: SvgStyle = fillPatternId
    ? { ...style, fill: { type: 'none' } }
    : style
  const paints = resolvePathPaintOptions(styleForDirectPaint, ctx.defs, commands, coords, matrix, ctx)
  if (!paints.fill && !paints.stroke) {
    renderMarkersForPath(commands, coords, style, ctx, matrix)
    return
  }

  const hasGradient = isGradientPaint(paints.fill) || isGradientPaint(paints.stroke)
  if (hasGradient) {
    if (!ctx.backend.drawPathWithPaints) {
      throw new Error('SVG gradient paint is not supported by current backend')
    }
    ctx.backend.drawPathWithPaints(transformed.commands, transformed.coords, paints)
    renderMarkersForPath(commands, coords, style, ctx, matrix)
    return
  }

  // Canvas with Path2D(d), d / AA.
  // Supporttimeexistingcolumndraw to.
  
  
  if (
    rawPathData &&
    !fillPatternId &&
    ctx.backend.drawPathData &&
    style.vectorEffect !== 'non-scaling-stroke'
  ) {
    const pathDataOpts = resolvePathDataShapeOptions(style, paints)
    if (pathDataOpts.fill || pathDataOpts.stroke) {
      const drawn = ctx.backend.drawPathData(rawPathData, buildPathDataTransform(matrix, ctx), pathDataOpts)
      if (drawn) {
        renderMarkersForPath(commands, coords, style, ctx, matrix)
        return
      }
    }
  }

  // Transform() case, coordinate previousconvert.
  // Convertrowcolumn with, path.
  
  
  if (
    ctx.backend.transform &&
    style.vectorEffect !== 'non-scaling-stroke'
  ) {
    const nativeOpts = resolvePathDataShapeOptions(style, paints)
    if (nativeOpts.fill || nativeOpts.stroke) {
      const [a, b, c, d, e, f] = buildPathDataTransform(matrix, ctx)
      ctx.backend.save()
      ctx.backend.transform(a, b, c, d, e, f)
      ctx.backend.drawPath(commands, coords, nativeOpts)
      ctx.backend.restore()
      renderMarkersForPath(commands, coords, style, ctx, matrix)
      return
    }
  }

  const fallbackOpts: ShapeDrawOptions = {
    fill: typeof paints.fill === 'string' ? paints.fill : undefined,
    stroke: typeof paints.stroke === 'string' ? paints.stroke : undefined,
    fillOpacity: paints.fillOpacity,
    strokeOpacity: paints.strokeOpacity,
    fillRule: paints.fillRule,
    strokeWidth: paints.strokeWidth,
    strokeLinecap: paints.strokeLinecap,
    strokeLinejoin: paints.strokeLinejoin,
    strokeMiterLimit: paints.strokeMiterLimit,
    strokeDasharray: paints.strokeDasharray,
    strokeDashoffset: paints.strokeDashoffset,
  }
  if (fallbackOpts.fill || fallbackOpts.stroke) {
    ctx.backend.drawPath(transformed.commands, transformed.coords, fallbackOpts)
  }
  renderMarkersForPath(commands, coords, style, ctx, matrix)
}

function buildPathDataTransform(
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): [number, number, number, number, number, number] {
  return [
    matrix[0] * ctx.scaleX,
    matrix[1] * ctx.scaleY,
    matrix[2] * ctx.scaleX,
    matrix[3] * ctx.scaleY,
    matrix[4] * ctx.scaleX + ctx.translateX,
    matrix[5] * ctx.scaleY + ctx.translateY,
  ]
}

function resolvePathDataShapeOptions(
  style: SvgStyle,
  paints: PathPaintOptions,
): ShapeDrawOptions {
  const opts: ShapeDrawOptions = {
    fill: typeof paints.fill === 'string' ? paints.fill : undefined,
    stroke: typeof paints.stroke === 'string' ? paints.stroke : undefined,
    fillOpacity: paints.fillOpacity,
    strokeOpacity: paints.strokeOpacity,
    fillRule: paints.fillRule,
  }

  if (opts.stroke) {
    opts.strokeWidth = style.strokeWidth ?? 1
    opts.strokeLinecap = style.strokeLinecap
    opts.strokeLinejoin = style.strokeLinejoin
    opts.strokeMiterLimit = style.strokeMiterLimit ?? 4
    opts.strokeDasharray = normalizeDashArray(style.strokeDasharray)
    opts.strokeDashoffset = style.strokeDashoffset
  }

  return opts
}

function renderRect(
  node: SvgRect,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  if (node.width <= 0 || node.height <= 0) return

  if (node.rx > 0 || node.ry > 0) {
    // Convert rounded rectangles to path commands.
    const pathData = roundedRectToPath(node.x, node.y, node.width, node.height, node.rx, node.ry)
    renderPath(pathData.commands, pathData.coords, style, ctx, matrix)
  } else {
    // Convert plain rectangles from their four corners.
    const x0 = node.x
    const y0 = node.y
    const x1 = node.x + node.width
    const y1 = node.y + node.height

    // Path as draw (convertrowcolumncase)
    
    const cmds = new Uint8Array([0, 1, 1, 1, 3]) // M L L L Z
    const cds = new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1])
    renderPath(cmds, cds, style, ctx, matrix)
  }
}

function renderCircle(
  node: SvgCircle,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  if (node.r <= 0) return
  renderEllipseShape(node.cx, node.cy, node.r, node.r, style, ctx, matrix)
}

function renderEllipse(
  node: SvgEllipse,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  if (node.rx <= 0 || node.ry <= 0) return
  renderEllipseShape(node.cx, node.cy, node.rx, node.ry, style, ctx, matrix)
}

function renderEllipseShape(
  cx: number, cy: number, rx: number, ry: number,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  const [cmds, cds] = ellipseToPath(cx, cy, rx, ry)
  renderPath(cmds, cds, style, ctx, matrix)
}

function renderLine(
  node: SvgLine,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  const cmds = new Uint8Array([0, 1]) // M L
  const cds = new Float32Array([node.x1, node.y1, node.x2, node.y2])
  renderPath(cmds, cds, style, ctx, matrix)
}

function renderPolyline(
  node: SvgPolyline,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  const pts = node.points
  if (pts.length < 4) return

  const numPoints = pts.length / 2
  const cmds = new Uint8Array(numPoints)
  cmds[0] = 0 // MoveTo
  for (let i = 1; i < numPoints; i++) cmds[i] = 1 // LineTo

  renderPath(cmds, pts, style, ctx, matrix)
}

function renderPolygon(
  node: SvgPolygon,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  const pts = node.points
  if (pts.length < 4) return

  const numPoints = pts.length / 2
  const cmds = new Uint8Array(numPoints + 1)
  cmds[0] = 0 // MoveTo
  for (let i = 1; i < numPoints; i++) cmds[i] = 1 // LineTo
  cmds[numPoints] = 3 // Close

  renderPath(cmds, pts, style, ctx, matrix)
}

function renderImage(
  node: SvgImage,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  if (node.width <= 0 || node.height <= 0) return

  const embedded = resolveSvgImageResource(node.href, ctx)
  const intrinsic = inferIntrinsicImageSize(node, embedded)
  const imageBox = resolveImageDestBox(node, intrinsic)
  if (imageBox.width <= 0 || imageBox.height <= 0) return

  const p0 = transformPoint(imageBox.x, imageBox.y, matrix, ctx)
  const px = transformPoint(imageBox.x + imageBox.width, imageBox.y, matrix, ctx)
  const py = transformPoint(imageBox.x, imageBox.y + imageBox.height, matrix, ctx)
  const vx = { x: px.x - p0.x, y: px.y - p0.y }
  const vy = { x: py.x - p0.x, y: py.y - p0.y }

  const clipBoxNeeded = imageBox.clipViewport
  let clipped = false
  if (clipBoxNeeded && ctx.backend.clipPath) {
    const c0 = transformPoint(node.x, node.y, matrix, ctx)
    const c1 = transformPoint(node.x + node.width, node.y, matrix, ctx)
    const c2 = transformPoint(node.x + node.width, node.y + node.height, matrix, ctx)
    const c3 = transformPoint(node.x, node.y + node.height, matrix, ctx)
    ctx.backend.save()
    const clipCommands = new Uint8Array([0, 1, 1, 1, 3])
    const clipCoords = new Float32Array([
      c0.x, c0.y,
      c1.x, c1.y,
      c2.x, c2.y,
      c3.x, c3.y,
    ])
    ctx.backend.clipPath(clipCommands, clipCoords, 'nonzero')
    clipped = true
  }

  const affine = toImageAffineFromRect(p0, vx, vy)
  if (embedded) {
    if (ctx.backend.drawImageDataAffine) {
      ctx.backend.drawImageDataAffine(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f, embedded.data, embedded.mimeType)
      if (clipped) ctx.backend.restore()
      return
    }
    if (ctx.backend.drawImageData) {
      const axis = tryAxisAlignedRectFromAffine(affine)
      if (!axis) {
        if (clipped) ctx.backend.restore()
        throw new Error('SVG <image> affine transform requires backend drawImageDataAffine support')
      }
      ctx.backend.drawImageData(axis.x, axis.y, axis.width, axis.height, embedded.data, embedded.mimeType)
      if (clipped) ctx.backend.restore()
      return
    }
  }
  if (ctx.backend.drawImageAffine) {
    ctx.backend.drawImageAffine(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f, node.href)
    if (clipped) ctx.backend.restore()
    return
  }

  const axis = tryAxisAlignedRectFromAffine(affine)
  if (!axis) {
    if (clipped) ctx.backend.restore()
    throw new Error('SVG <image> affine transform is not supported by current backend')
  }
  ctx.backend.drawImage(axis.x, axis.y, axis.width, axis.height, node.href)
  if (clipped) ctx.backend.restore()
}

function renderMarkersForPath(
  commands: Uint8Array,
  coords: Float32Array,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  if (!style.markerStart && !style.markerMid && !style.markerEnd) return

  const subpaths = extractPathSubpaths(commands, coords)
  for (let i = 0; i < subpaths.length; i++) {
    const sp = subpaths[i]!
    if (sp.points.length === 0) continue
    const points = sp.points
    if (style.markerStart) {
      const first = points[0]!
      const angle = resolveMarkerAngle(first, 'start')
      renderMarkerInstance(style.markerStart, first.x, first.y, angle, true, style, ctx, matrix)
    }
    if (style.markerMid && points.length > 1) {
      const end = sp.closed ? points.length : points.length - 1
      for (let pi = 1; pi < end; pi++) {
        const p = points[pi]!
        const angle = resolveMarkerAngle(p, 'mid')
        renderMarkerInstance(style.markerMid, p.x, p.y, angle, false, style, ctx, matrix)
      }
    }
    if (style.markerEnd && points.length > 1) {
      const endPoint = sp.closed ? points[0]! : points[points.length - 1]!
      const angle = resolveMarkerAngle(endPoint, 'end')
      renderMarkerInstance(style.markerEnd, endPoint.x, endPoint.y, angle, false, style, ctx, matrix)
    }
  }
}

function renderMarkerInstance(
  markerId: string,
  x: number,
  y: number,
  autoAngleDeg: number,
  isStart: boolean,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  const marker = ctx.defs.markers.get(markerId)
  if (!marker) return
  if (marker.children.length === 0) return

  const markerScale = marker.markerUnits === 'strokeWidth' ? style.strokeWidth ?? 1 : 1
  let angle = autoAngleDeg
  if (typeof marker.orient === 'number') {
    angle = marker.orient
  } else if (marker.orient === 'auto-start-reverse' && isStart) {
    angle = autoAngleDeg + 180
  }
  const rad = angle * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const vb = marker.viewBox
  const fit = vb && vb.width > 0 && vb.height > 0
    ? computeViewBoxToViewportTransform(vb, marker.markerWidth, marker.markerHeight, marker.preserveAspectRatio ?? 'xMidYMid meet')
    : null

  let markerMatrix: SvgMatrix = [1, 0, 0, 1, x, y]
  markerMatrix = multiplyMatrix(markerMatrix, [cos, sin, -sin, cos, 0, 0])
  markerMatrix = multiplyMatrix(markerMatrix, [markerScale, 0, 0, markerScale, 0, 0])
  let markerViewportClip = marker.overflow === 'hidden'
    ? { x: 0, y: 0, width: marker.markerWidth, height: marker.markerHeight }
    : undefined
  if (fit) {
    const mappedRefX = marker.refX * fit.scaleX + fit.translateX
    const mappedRefY = marker.refY * fit.scaleY + fit.translateY
    markerMatrix = multiplyMatrix(markerMatrix, [1, 0, 0, 1, -mappedRefX, -mappedRefY])
    markerMatrix = multiplyMatrix(markerMatrix, [fit.scaleX, 0, 0, fit.scaleY, fit.translateX, fit.translateY])
    if (markerViewportClip !== undefined) {
      markerViewportClip = {
        x: -fit.translateX / fit.scaleX,
        y: -fit.translateY / fit.scaleY,
        width: marker.markerWidth / fit.scaleX,
        height: marker.markerHeight / fit.scaleY,
      }
    }
  } else {
    markerMatrix = multiplyMatrix(markerMatrix, [1, 0, 0, 1, -marker.refX, -marker.refY])
  }
  markerMatrix = multiplyMatrix(matrix, markerMatrix)
  renderNode({ type: 'g', children: marker.children, style: {}, viewportClip: markerViewportClip }, ctx, markerMatrix, {})
}

interface MarkerPoint {
  x: number
  y: number
  inX: number
  inY: number
  outX: number
  outY: number
}

interface PathSubpath {
  points: MarkerPoint[]
  closed: boolean
}

function extractPathSubpaths(commands: Uint8Array, coords: Float32Array): PathSubpath[] {
  const out: PathSubpath[] = []
  let current: PathSubpath | null = null
  let ci = 0

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    if (cmd === 0) {
      if (current && current.points.length > 0) out.push(current)
      const x = coords[ci]!
      const y = coords[ci + 1]!
      ci += 2
      current = { points: [{ x, y, inX: 0, inY: 0, outX: 0, outY: 0 }], closed: false }
      continue
    }
    if (!current) continue
    if (cmd === 1) {
      const x = coords[ci]!
      const y = coords[ci + 1]!
      ci += 2
      appendLinePoint(current, x, y)
    } else if (cmd === 2) {
      const cp1x = coords[ci]!
      const cp1y = coords[ci + 1]!
      const cp2x = coords[ci + 2]!
      const cp2y = coords[ci + 3]!
      const x = coords[ci + 4]!
      const y = coords[ci + 5]!
      ci += 6
      appendCubicPoint(current, cp1x, cp1y, cp2x, cp2y, x, y)
    } else if (cmd === 3) {
      current.closed = true
      if (current.points.length > 1) {
        connectCloseSegment(current)
      }
      if (current.points.length > 0) out.push(current)
      current = null
    }
  }
  if (current && current.points.length > 0) out.push(current)
  return out
}

function appendLinePoint(sp: PathSubpath, x: number, y: number): void {
  if (sp.points.length === 0) {
    sp.points.push({ x, y, inX: 0, inY: 0, outX: 0, outY: 0 })
    return
  }
  const prev = sp.points[sp.points.length - 1]!
  const dx = x - prev.x
  const dy = y - prev.y
  if (Math.hypot(dx, dy) > 1e-9) {
    prev.outX = dx
    prev.outY = dy
  }
  sp.points.push({
    x,
    y,
    inX: dx,
    inY: dy,
    outX: 0,
    outY: 0,
  })
}

function appendCubicPoint(
  sp: PathSubpath,
  cp1x: number,
  cp1y: number,
  cp2x: number,
  cp2y: number,
  x: number,
  y: number,
): void {
  if (sp.points.length === 0) {
    sp.points.push({ x, y, inX: 0, inY: 0, outX: 0, outY: 0 })
    return
  }
  const prev = sp.points[sp.points.length - 1]!
  const outTan = firstNonZeroVector([
    { x: cp1x - prev.x, y: cp1y - prev.y },
    { x: cp2x - prev.x, y: cp2y - prev.y },
    { x: x - prev.x, y: y - prev.y },
  ])
  const inTan = firstNonZeroVector([
    { x: x - cp2x, y: y - cp2y },
    { x: x - cp1x, y: y - cp1y },
    { x: x - prev.x, y: y - prev.y },
  ])
  if (outTan) {
    prev.outX = outTan.x
    prev.outY = outTan.y
  }
  sp.points.push({
    x,
    y,
    inX: inTan?.x ?? 0,
    inY: inTan?.y ?? 0,
    outX: 0,
    outY: 0,
  })
}

function connectCloseSegment(sp: PathSubpath): void {
  const first = sp.points[0]!
  const last = sp.points[sp.points.length - 1]!
  const dx = first.x - last.x
  const dy = first.y - last.y
  if (Math.hypot(dx, dy) <= 1e-9) return
  last.outX = dx
  last.outY = dy
  first.inX = dx
  first.inY = dy
}

function firstNonZeroVector(vectors: Array<{ x: number, y: number }>): { x: number, y: number } | null {
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i]!
    if (Math.hypot(v.x, v.y) > 1e-9) return v
  }
  return null
}

function resolveMarkerAngle(point: MarkerPoint, kind: 'start' | 'mid' | 'end'): number {
  if (kind === 'start') {
    return angleDegFromBest(point.outX, point.outY, point.inX, point.inY)
  }
  if (kind === 'end') {
    return angleDegFromBest(point.inX, point.inY, point.outX, point.outY)
  }
  const inNorm = normalizeVector(point.inX, point.inY)
  const outNorm = normalizeVector(point.outX, point.outY)
  if (inNorm && outNorm) {
    let x = inNorm.x + outNorm.x
    let y = inNorm.y + outNorm.y
    if (Math.hypot(x, y) <= 1e-9) {
      x = outNorm.x
      y = outNorm.y
    }
    return angleDeg(x, y)
  }
  if (outNorm) return angleDeg(outNorm.x, outNorm.y)
  if (inNorm) return angleDeg(inNorm.x, inNorm.y)
  return 0
}

function angleDegFromBest(px: number, py: number, sx: number, sy: number): number {
  if (Math.hypot(px, py) > 1e-9) return angleDeg(px, py)
  if (Math.hypot(sx, sy) > 1e-9) return angleDeg(sx, sy)
  return 0
}

function normalizeVector(x: number, y: number): { x: number, y: number } | null {
  const len = Math.hypot(x, y)
  if (len <= 1e-9) return null
  return { x: x / len, y: y / len }
}

function angleDeg(dx: number, dy: number): number {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return 0
  return Math.atan2(dy, dx) * 180 / Math.PI
}

interface PathData {
  commands: Uint8Array
  coords: Float32Array
  fillRule?: 'nonzero' | 'evenodd'
}

function resolveClipPathData(
  clipPathId: string,
  node: SvgNode,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
  style: SvgStyle,
): PathData | null {
  const clipPath = ctx.defs.clipPaths.get(clipPathId)
  if (!clipPath) return null

  if (clipPath.clipPathUnits === 'objectBoundingBox') {
    const bounds = computeRenderedNodePaintBounds(node, style, matrix)
    if (!bounds) return null
    const bw = Math.max(bounds.width, 1e-6)
    const bh = Math.max(bounds.height, 1e-6)

    const bboxMatrix: SvgMatrix = [
      bw, 0,
      0, bh,
      bounds.minX, bounds.minY,
    ]
    const out = collectNodesGeometry(clipPath.children, bboxMatrix)
    if (out) out.fillRule = clipPath.clipRule
    return out ? applyViewportToPathData(out, ctx) : null
  }

  // userSpaceOnUse
  const out = collectNodesGeometry(clipPath.children, matrix)
  if (out) out.fillRule = clipPath.clipRule
  return out ? applyViewportToPathData(out, ctx) : null
}

function resolveNodeViewportClip(node: SvgNode, matrix: SvgMatrix, ctx: SvgRenderContext): PathData | null {
  const clip = node.viewportClip
  if (!clip) return null
  const path = transformPathByMatrix(
    new Uint8Array([0, 1, 1, 1, 3]),
    new Float32Array([
      clip.x, clip.y,
      clip.x + clip.width, clip.y,
      clip.x + clip.width, clip.y + clip.height,
      clip.x, clip.y + clip.height,
    ]),
    matrix,
  )
  return applyViewportToPathData(path, ctx)
}

function resolveMaskRegionPath(mask: SvgMask, bounds: CoordBounds | null): PathData | null {
  let x = mask.x
  let y = mask.y
  let w = mask.width
  let h = mask.height
  if (mask.maskUnits === 'objectBoundingBox') {
    if (!bounds) return null
    const bw = Math.max(bounds.width, 1e-6)
    const bh = Math.max(bounds.height, 1e-6)
    x = bounds.minX + mask.x * bw
    y = bounds.minY + mask.y * bh
    w = mask.width * bw
    h = mask.height * bh
  }
  if (!(w > 0) || !(h > 0)) return null
  const commands = new Uint8Array([0, 1, 1, 1, 3])
  const coords = new Float32Array([
    x, y,
    x + w, y,
    x + w, y + h,
    x, y + h,
  ])
  return { commands, coords, fillRule: 'nonzero' }
}

function resolveFilterRegionPath(
  node: SvgNode,
  filter: SvgDropShadowFilter | SvgFilterGraph,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  style: SvgStyle,
): PathData | null {
  const bounds = computeRenderedNodePaintBounds(node, style, matrix)
  if (!bounds) return null

  let x = filter.x
  let y = filter.y
  let w = filter.width
  let h = filter.height
  if (filter.filterUnits === 'objectBoundingBox') {
    const bw = Math.max(bounds.width, 1e-6)
    const bh = Math.max(bounds.height, 1e-6)
    x = bounds.minX + filter.x * bw
    y = bounds.minY + filter.y * bh
    w = filter.width * bw
    h = filter.height * bh
  }
  if (!(w > 0) || !(h > 0)) return null

  const commands = new Uint8Array([0, 1, 1, 1, 3])
  const coords = new Float32Array([
    x, y,
    x + w, y,
    x + w, y + h,
    x, y + h,
  ])
  const path = { commands, coords, fillRule: 'nonzero' as const }
  return applyViewportToPathData(
    filter.filterUnits === 'userSpaceOnUse'
      ? transformPathByMatrix(path.commands, path.coords, matrix)
      : path,
    ctx,
  )
}

function resolveFilterPrimitiveTransform(
  filter: SvgFilterGraph,
  node: SvgNode,
  style: SvgStyle,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  rasterOriginX: number,
  rasterOriginY: number,
): SvgMatrix {
  if (filter.primitiveUnits === 'objectBoundingBox') {
    const bounds = computeRenderedNodePaintBounds(node, style, matrix)
    if (!bounds) return [0, 0, 0, 0, 0, 0]
    return [
      bounds.width * ctx.scaleX,
      0,
      0,
      bounds.height * ctx.scaleY,
      bounds.minX * ctx.scaleX + ctx.translateX - rasterOriginX,
      bounds.minY * ctx.scaleY + ctx.translateY - rasterOriginY,
    ]
  }
  return [
    matrix[0] * ctx.scaleX,
    matrix[1] * ctx.scaleY,
    matrix[2] * ctx.scaleX,
    matrix[3] * ctx.scaleY,
    matrix[4] * ctx.scaleX + ctx.translateX - rasterOriginX,
    matrix[5] * ctx.scaleY + ctx.translateY - rasterOriginY,
  ]
}

function resolveFilterShadowMetrics(
  node: SvgNode,
  style: SvgStyle,
  matrix: SvgMatrix,
  filter: SvgDropShadowFilter,
): { dx: number, dy: number, stdDeviationX: number, stdDeviationY: number } {
  let dx = filter.dx
  let dy = filter.dy
  let stdDeviationX = Math.max(0, filter.stdDeviationX ?? filter.stdDeviation)
  let stdDeviationY = Math.max(0, filter.stdDeviationY ?? filter.stdDeviation)
  if (filter.primitiveUnits !== 'objectBoundingBox') {
    return { dx, dy, stdDeviationX, stdDeviationY }
  }

  const bounds = computeRenderedNodePaintBounds(node, style, matrix)
  if (!bounds) {
    return { dx: 0, dy: 0, stdDeviationX: 0, stdDeviationY: 0 }
  }
  const bw = Math.max(bounds.width, 1e-6)
  const bh = Math.max(bounds.height, 1e-6)
  dx *= bw
  dy *= bh
  stdDeviationX *= bw
  stdDeviationY *= bh
  return { dx, dy, stdDeviationX, stdDeviationY }
}

function resolvePatternId(paint: SvgPaint | undefined, defs: SvgDefs): string | null {
  if (!paint || paint.type !== 'url' || !paint.url) return null
  return defs.patterns.has(paint.url) ? paint.url : null
}

function renderPatternFillPath(
  patternId: string,
  commands: Uint8Array,
  coords: Float32Array,
  fillRule: 'nonzero' | 'evenodd',
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  const pattern = ctx.defs.patterns.get(patternId)
  if (!pattern) return
  if (!ctx.backend.clipPath) {
    throw new Error('SVG pattern fill is not supported by current backend')
  }
  if (ctx.patternStack.includes(patternId)) return

  const bounds = computeCoordBounds(coords)
  if (!bounds) return

  let tileX: number
  let tileY: number
  let tileW: number
  let tileH: number
  if (pattern.patternUnits === 'objectBoundingBox') {
    tileX = bounds.minX + pattern.x * bounds.width
    tileY = bounds.minY + pattern.y * bounds.height
    tileW = pattern.width * bounds.width
    tileH = pattern.height * bounds.height
  } else {
    const p = transformPoint(pattern.x, pattern.y, matrix, ctx)
    const s = approxRenderScale(matrix, ctx)
    tileX = p.x
    tileY = p.y
    tileW = pattern.width * s
    tileH = pattern.height * s
  }
  if (!(tileW > 0) || !(tileH > 0)) return

  const startX = tileX + Math.floor((bounds.minX - tileX) / tileW) * tileW
  const startY = tileY + Math.floor((bounds.minY - tileY) / tileH) * tileH

  ctx.patternStack.push(patternId)
  ctx.backend.save()
  ctx.backend.clipPath(commands, coords, fillRule)

  let tiles = 0
  const maxTiles = 4096
  for (let y = startY; y < bounds.maxY + tileH * 0.5; y += tileH) {
    for (let x = startX; x < bounds.maxX + tileW * 0.5; x += tileW) {
      if (++tiles > maxTiles) break

      let tileMatrix: SvgMatrix
      if (pattern.viewBox) {
        const fit = computeViewBoxToViewportTransform(
          pattern.viewBox,
          tileW,
          tileH,
          pattern.preserveAspectRatio ?? 'xMidYMid meet',
        )
        tileMatrix = [fit.scaleX, 0, 0, fit.scaleY, x + fit.translateX, y + fit.translateY]
      } else if (pattern.patternContentUnits === 'objectBoundingBox') {
        tileMatrix = [tileW, 0, 0, tileH, x, y]
      } else {
        const s = approxRenderScale(matrix, ctx)
        tileMatrix = [s, 0, 0, s, x, y]
      }
      if (pattern.patternTransform) {
        tileMatrix = multiplyMatrix(tileMatrix, pattern.patternTransform)
      }
      for (let i = 0; i < pattern.children.length; i++) {
        renderNode(pattern.children[i]!, ctx, tileMatrix, {})
      }
    }
    if (tiles > maxTiles) break
  }

  ctx.backend.restore()
  ctx.patternStack.pop()
}

function collectNodesGeometry(nodes: SvgNode[], matrix: SvgMatrix): PathData | null {
  const parts: PathData[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    let m = matrix
    if (n.transform) {
      m = multiplyMatrix(matrix, n.transform)
    }
    const p = collectNodeGeometryCore(n, m)
    if (p) parts.push(p)
  }
  return concatPaths(parts)
}

function collectNodeGeometry(node: SvgNode, matrix: SvgMatrix): PathData | null {
  return collectNodeGeometryCore(node, matrix)
}

function collectNodeGeometryCore(node: SvgNode, matrix: SvgMatrix): PathData | null {
  switch (node.type) {
    case 'g':
      return collectNodesGeometry(node.children, matrix)
    case 'path':
      return transformPathByMatrix(node.commands, node.coords, matrix)
    case 'rect': {
      if (node.width <= 0 || node.height <= 0) return null
      if (node.rx > 0 || node.ry > 0) {
        const rr = roundedRectToPath(node.x, node.y, node.width, node.height, node.rx, node.ry)
        return transformPathByMatrix(rr.commands, rr.coords, matrix)
      }
      const cmds = new Uint8Array([0, 1, 1, 1, 3])
      const cds = new Float32Array([
        node.x, node.y,
        node.x + node.width, node.y,
        node.x + node.width, node.y + node.height,
        node.x, node.y + node.height,
      ])
      return transformPathByMatrix(cmds, cds, matrix)
    }
    case 'circle':
      if (node.r <= 0) return null
      return transformPathByMatrix(...ellipseToPath(node.cx, node.cy, node.r, node.r), matrix)
    case 'ellipse':
      if (node.rx <= 0 || node.ry <= 0) return null
      return transformPathByMatrix(...ellipseToPath(node.cx, node.cy, node.rx, node.ry), matrix)
    case 'line': {
      const cmds = new Uint8Array([0, 1])
      const cds = new Float32Array([node.x1, node.y1, node.x2, node.y2])
      return transformPathByMatrix(cmds, cds, matrix)
    }
    case 'polyline': {
      if (node.points.length < 4) return null
      const numPoints = node.points.length / 2
      const cmds = new Uint8Array(numPoints)
      cmds[0] = 0
      for (let i = 1; i < numPoints; i++) cmds[i] = 1
      return transformPathByMatrix(cmds, node.points, matrix)
    }
    case 'polygon': {
      if (node.points.length < 4) return null
      const numPoints = node.points.length / 2
      const cmds = new Uint8Array(numPoints + 1)
      cmds[0] = 0
      for (let i = 1; i < numPoints; i++) cmds[i] = 1
      cmds[numPoints] = 3
      return transformPathByMatrix(cmds, node.points, matrix)
    }
    case 'text':
    case 'image':
      return null
  }
}

function transformPathByMatrix(
  commands: Uint8Array,
  coords: Float32Array,
  matrix: SvgMatrix,
): PathData {
  const out = new Float32Array(coords.length)
  let ci = 0
  for (let i = 0; i < commands.length; i++) {
    switch (commands[i]) {
      case 0:
      case 1: {
        const x = coords[ci]!
        const y = coords[ci + 1]!
        out[ci] = matrix[0] * x + matrix[2] * y + matrix[4]
        out[ci + 1] = matrix[1] * x + matrix[3] * y + matrix[5]
        ci += 2
        break
      }
      case 2: {
        for (let j = 0; j < 3; j++) {
          const x = coords[ci]!
          const y = coords[ci + 1]!
          out[ci] = matrix[0] * x + matrix[2] * y + matrix[4]
          out[ci + 1] = matrix[1] * x + matrix[3] * y + matrix[5]
          ci += 2
        }
        break
      }
      case 3:
        break
    }
  }
  return { commands, coords: out }
}

function applyViewportToPathData(path: PathData, ctx: SvgRenderContext): PathData {
  const out = new Float32Array(path.coords.length)
  for (let i = 0; i < path.coords.length; i += 2) {
    out[i] = path.coords[i]! * ctx.scaleX + ctx.translateX
    out[i + 1] = path.coords[i + 1]! * ctx.scaleY + ctx.translateY
  }
  return {
    commands: path.commands,
    coords: out,
    fillRule: path.fillRule,
  }
}

function concatPaths(paths: PathData[]): PathData | null {
  if (paths.length === 0) return null
  if (paths.length === 1) return paths[0]!

  let totalCmd = 0
  let totalCds = 0
  for (let i = 0; i < paths.length; i++) {
    totalCmd += paths[i]!.commands.length
    totalCds += paths[i]!.coords.length
  }

  const commands = new Uint8Array(totalCmd)
  const coords = new Float32Array(totalCds)
  let ci = 0
  let pi = 0
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]!
    commands.set(p.commands, ci)
    coords.set(p.coords, pi)
    ci += p.commands.length
    pi += p.coords.length
  }
  return { commands, coords }
}

function renderText(
  node: SvgText,
  style: SvgStyle,
  ctx: SvgRenderContext,
  matrix: SvgMatrix,
): void {
  const text = normalizeSvgText(node.content)
  if (!text) return

  const fillColor = resolveTextFillColor(style, ctx.defs)
  if (!fillColor) return

  const p = transformPoint(node.x, node.y, matrix, ctx)
  const fontSize = Math.max(0.1, (style.fontSize ?? 16) * approxMatrixScale(matrix) * ctx.scaleX)

  const textAnchor = style.textAnchor ?? 'start'
  const hAlign = textAnchor === 'middle' ? 'center' : textAnchor === 'end' ? 'right' : 'left'

  const preferredFontId = extractFontId(style.fontFamily)
  try {
    ctx.backend.drawText(p.x, p.y, text, preferredFontId, fontSize, fillColor, {
      hAlign,
      width: hAlign === 'left' ? undefined : 0,
      bold: style.fontWeight === 'bold' || style.fontWeight === '700',
      italic: style.fontStyle === 'italic',
    })
  } catch {
    // PDF backend fontId with exception default.
    
    try {
      ctx.backend.drawText(p.x, p.y, text, 'default', fontSize, fillColor, {
        hAlign,
        width: hAlign === 'left' ? undefined : 0,
        bold: style.fontWeight === 'bold' || style.fontWeight === '700',
        italic: style.fontStyle === 'italic',
      })
    } catch {
      // Fontregistertimedraw (SVGrendering)
      
    }
  }
}

// Coordinateconvert.


function transformCoords(
  commands: Uint8Array,
  coords: Float32Array,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): { commands: Uint8Array, coords: Float32Array } {
  // Convertaftercoordinate with,.
  // Time Float32Array as.
  
  
  const outCoords = new Float64Array(coords.length)
  const sx = ctx.scaleX
  const sy = ctx.scaleY
  const tx = ctx.translateX
  const ty = ctx.translateY

  let ci = 0
  for (let i = 0; i < commands.length; i++) {
    switch (commands[i]) {
      case 0: // MoveTo
      case 1: { // LineTo
        const x = coords[ci]!
        const y = coords[ci + 1]!
        // Rowcolumnapply + viewBox.
        
        const wx = matrix[0] * x + matrix[2] * y + matrix[4]
        const wy = matrix[1] * x + matrix[3] * y + matrix[5]
        outCoords[ci] = wx * sx + tx
        outCoords[ci + 1] = wy * sy + ty
        ci += 2
        break
      }
      case 2: { // CubicTo
        for (let j = 0; j < 3; j++) {
          const x = coords[ci]!
          const y = coords[ci + 1]!
          const wx = matrix[0] * x + matrix[2] * y + matrix[4]
          const wy = matrix[1] * x + matrix[3] * y + matrix[5]
          outCoords[ci] = wx * sx + tx
          outCoords[ci + 1] = wy * sy + ty
          ci += 2
        }
        break
      }
      case 3: // Close
        break
    }
  }

  return { commands, coords: outCoords as unknown as Float32Array }
}

interface CoordBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

function computeCoordBounds(coords: Float32Array): CoordBounds | null {
  if (coords.length < 2) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i]!
    const y = coords[i + 1]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  }
}

function computePathGeometryBounds(commands: Uint8Array, coords: Float32Array): CoordBounds | null {
  if (commands.length === 0 || coords.length < 2) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let hasPoint = false

  const includePoint = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    hasPoint = true
  }

  const evalCubic = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const mt = 1 - t
    return mt * mt * mt * p0
      + 3 * mt * mt * t * p1
      + 3 * mt * t * t * p2
      + t * t * t * p3
  }

  const addCubicExtrema = (p0: number, p1: number, p2: number, p3: number, out: number[]): void => {
    const a = -p0 + 3 * p1 - 3 * p2 + p3
    const b = 2 * (p0 - 2 * p1 + p2)
    const c = -p0 + p1
    if (Math.abs(a) <= 1e-12) {
      if (Math.abs(b) <= 1e-12) return
      const t = -c / b
      if (t > 1e-9 && t < 1 - 1e-9) out.push(t)
      return
    }
    const disc = b * b - 4 * a * c
    if (disc < 0) return
    if (disc <= 1e-12) {
      const t = -b / (2 * a)
      if (t > 1e-9 && t < 1 - 1e-9) out.push(t)
      return
    }
    const sqrtDisc = Math.sqrt(disc)
    const t1 = (-b + sqrtDisc) / (2 * a)
    const t2 = (-b - sqrtDisc) / (2 * a)
    if (t1 > 1e-9 && t1 < 1 - 1e-9) out.push(t1)
    if (t2 > 1e-9 && t2 < 1 - 1e-9) out.push(t2)
  }

  let ci = 0
  let currentX = 0
  let currentY = 0
  let subpathStartX = 0
  let subpathStartY = 0
  let hasCurrent = false

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!
    switch (cmd) {
      case 0: { // MoveTo
        if (ci + 1 >= coords.length) break
        const x = coords[ci]!
        const y = coords[ci + 1]!
        ci += 2
        currentX = x
        currentY = y
        subpathStartX = x
        subpathStartY = y
        hasCurrent = true
        includePoint(x, y)
        break
      }
      case 1: { // LineTo
        if (!hasCurrent || ci + 1 >= coords.length) break
        const x = coords[ci]!
        const y = coords[ci + 1]!
        ci += 2
        includePoint(currentX, currentY)
        includePoint(x, y)
        currentX = x
        currentY = y
        break
      }
      case 2: { // CubicTo
        if (!hasCurrent || ci + 5 >= coords.length) break
        const p0x = currentX
        const p0y = currentY
        const p1x = coords[ci]!
        const p1y = coords[ci + 1]!
        const p2x = coords[ci + 2]!
        const p2y = coords[ci + 3]!
        const p3x = coords[ci + 4]!
        const p3y = coords[ci + 5]!
        ci += 6

        includePoint(p0x, p0y)
        includePoint(p3x, p3y)

        const tx: number[] = []
        const ty: number[] = []
        addCubicExtrema(p0x, p1x, p2x, p3x, tx)
        addCubicExtrema(p0y, p1y, p2y, p3y, ty)
        for (let ti = 0; ti < tx.length; ti++) {
          const t = tx[ti]!
          includePoint(evalCubic(p0x, p1x, p2x, p3x, t), evalCubic(p0y, p1y, p2y, p3y, t))
        }
        for (let ti = 0; ti < ty.length; ti++) {
          const t = ty[ti]!
          includePoint(evalCubic(p0x, p1x, p2x, p3x, t), evalCubic(p0y, p1y, p2y, p3y, t))
        }

        currentX = p3x
        currentY = p3y
        break
      }
      case 3: { // Close
        if (!hasCurrent) break
        includePoint(currentX, currentY)
        includePoint(subpathStartX, subpathStartY)
        currentX = subpathStartX
        currentY = subpathStartY
        break
      }
      default:
        break
    }
  }

  if (!hasPoint) return null
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  }
}

function unionBounds(a: CoordBounds | null, b: CoordBounds | null): CoordBounds | null {
  if (!a) return b
  if (!b) return a
  const minX = Math.min(a.minX, b.minX)
  const minY = Math.min(a.minY, b.minY)
  const maxX = Math.max(a.maxX, b.maxX)
  const maxY = Math.max(a.maxY, b.maxY)
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  }
}

function computeNodePaintBounds(
  node: SvgNode,
  parentStyle: SvgStyle,
  parentMatrix: SvgMatrix,
): CoordBounds | null {
  const style = mergeStyle(parentStyle, node.style)
  if (style.display === 'none' || style.visibility === 'hidden') return null

  let matrix = parentMatrix
  if (node.transform) {
    matrix = multiplyMatrix(parentMatrix, node.transform)
  }

  if (node.type === 'g') {
    let merged: CoordBounds | null = null
    for (let i = 0; i < node.children.length; i++) {
      const childBounds = computeNodePaintBounds(node.children[i]!, style, matrix)
      merged = unionBounds(merged, childBounds)
    }
    return merged
  }
  if (node.type === 'text' || node.type === 'image') return null

  const path = collectNodeGeometryCore(node, matrix)
  if (!path) return null
  const geomBounds = computePathGeometryBounds(path.commands, path.coords)
  if (!geomBounds) return null
  return expandBoundsForStyleStroke(geomBounds, style, matrix)
}

/** Computes bounds when the caller has already resolved this node's style and transform. */
function computeRenderedNodePaintBounds(
  node: SvgNode,
  style: SvgStyle,
  matrix: SvgMatrix,
): CoordBounds | null {
  if (style.display === 'none' || style.visibility === 'hidden') return null
  if (node.type === 'g') {
    let merged: CoordBounds | null = null
    for (let i = 0; i < node.children.length; i++) {
      merged = unionBounds(merged, computeNodePaintBounds(node.children[i]!, style, matrix))
    }
    return merged
  }
  if (node.type === 'text' || node.type === 'image') return null
  const path = collectNodeGeometryCore(node, matrix)
  if (!path) return null
  const geometry = computePathGeometryBounds(path.commands, path.coords)
  return geometry ? expandBoundsForStyleStroke(geometry, style, matrix) : null
}

function resolveNodeDeviceBounds(
  node: SvgNode,
  style: SvgStyle,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): CoordBounds | null {
  if (node.filterId) {
    const filter = ctx.defs.filters.get(node.filterId)
    if (filter) {
      const region = resolveFilterRegionPath(node, filter, matrix, ctx, style)
      if (region) return computeCoordBounds(region.coords)
    }
  }
  if (node.type === 'g') {
    let combined: CoordBounds | null = null
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!
      const childStyle = mergeStyle(style, child.style)
      let childMatrix = matrix
      if (child.transform) childMatrix = multiplyMatrix(matrix, child.transform)
      combined = unionBounds(combined, resolveNodeDeviceBounds(child, childStyle, childMatrix, ctx))
    }
    return combined
  }
  const bounds = computeRenderedNodePaintBounds(node, style, matrix)
  if (!bounds) return null
  const coords = new Float32Array([
    bounds.minX, bounds.minY,
    bounds.maxX, bounds.minY,
    bounds.maxX, bounds.maxY,
    bounds.minX, bounds.maxY,
  ])
  return computeCoordBounds(applyViewportToPathData({ commands: new Uint8Array([0, 1, 1, 1]), coords }, ctx).coords)
}

function resolvePathPaintOptions(
  style: SvgStyle,
  defs: SvgDefs,
  localCommands: Uint8Array,
  localCoords: Float32Array,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): PathPaintOptions {
  const localBounds = computePathGeometryBounds(localCommands, localCoords)
  const strokeScale = resolveStrokeRenderScale(style, matrix, ctx)
  const rawStrokeWidth = style.strokeWidth ?? 1
  const strokeWidth = rawStrokeWidth * strokeScale
  const currentColor = style.color ?? ctx.foregroundColor ?? { r: 0, g: 0, b: 0 }
  const fill = resolvePaintValue(style.fill, 'fill', defs, localBounds, matrix, ctx, currentColor)
  const stroke = resolvePaintValue(style.stroke, 'stroke', defs, localBounds, matrix, ctx, currentColor)
  const opts: PathPaintOptions = {
    fill: fill.paint,
    stroke: stroke.paint,
  }
  if (opts.fill) {
    opts.fillOpacity = clamp01(fill.opacity * (style.fillOpacity ?? 1))
  }
  if (opts.stroke) {
    opts.strokeOpacity = clamp01(stroke.opacity * (style.strokeOpacity ?? 1))
  }
  opts.fillRule = style.fillRule

  if (opts.stroke) {
    opts.strokeWidth = strokeWidth
    opts.strokeLinecap = style.strokeLinecap
    opts.strokeLinejoin = style.strokeLinejoin
    opts.strokeMiterLimit = style.strokeMiterLimit ?? 4
    const dash = normalizeDashArray(style.strokeDasharray)
    opts.strokeDasharray = dash ? dash.map(v => v * strokeScale) : undefined
    opts.strokeDashoffset = style.strokeDashoffset != null
      ? style.strokeDashoffset * strokeScale
      : undefined
  }

  return opts
}

function expandBoundsForStroke(bounds: CoordBounds | null, strokeWidth: number): CoordBounds | null {
  if (!bounds) return null
  const half = Math.max(0, strokeWidth) * 0.5
  return {
    minX: bounds.minX - half,
    minY: bounds.minY - half,
    maxX: bounds.maxX + half,
    maxY: bounds.maxY + half,
    width: Math.max(bounds.width + half * 2, 1e-6),
    height: Math.max(bounds.height + half * 2, 1e-6),
  }
}

function expandBoundsForStyleStroke(
  bounds: CoordBounds | null,
  style: SvgStyle,
  matrix: SvgMatrix,
): CoordBounds | null {
  if (!bounds) return null
  if (!style.stroke || style.stroke.type === 'none') return bounds
  if ((style.stroke.opacity ?? 1) <= 0) return bounds
  if ((style.strokeOpacity ?? 1) <= 0) return bounds
  const rawStrokeWidth = style.strokeWidth ?? 1
  if (!(rawStrokeWidth > 0)) return bounds
  const strokeScale = resolveStrokeBoundsScale(style, matrix)
  return expandBoundsForStroke(bounds, rawStrokeWidth * strokeScale)
}

function resolvePaintValue(
  paint: SvgPaint | undefined,
  kind: 'fill' | 'stroke',
  defs: SvgDefs,
  objectBounds: CoordBounds | null,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
  currentColor: SvgColor,
): { paint?: PaintValue, opacity: number } {
  if (!paint) {
    return {
      paint: kind === 'fill' ? '#000000' : undefined,
      opacity: 1,
    }
  }

  if (paint.type === 'none') return { paint: undefined, opacity: 1 }
  if (paint.type === 'currentColor') {
    const palette = resolveSvgPaletteColor(paint.paletteIndex, ctx)
    const opacity = clamp01((paint.opacity ?? 1) * (palette ? (palette.a ?? 255) / 255 : 1))
    if (opacity <= 0) return { paint: undefined, opacity: 1 }
    return {
      paint: colorToHex(palette ?? currentColor),
      opacity,
    }
  }
  if (paint.type === 'color') {
    const palette = resolveSvgPaletteColor(paint.paletteIndex, ctx)
    const opacity = clamp01((paint.opacity ?? 1) * (palette ? (palette.a ?? 255) / 255 : 1))
    if (opacity <= 0) return { paint: undefined, opacity: 1 }
    return {
      paint: colorToHex(palette ?? paint.color ?? { r: 0, g: 0, b: 0 }),
      opacity,
    }
  }
  if (paint.type !== 'url' || !paint.url) return { paint: undefined, opacity: 1 }

  const gradientPaint = resolveGradientPaint(paint.url, defs, objectBounds, matrix, ctx)
  if (gradientPaint) return { paint: gradientPaint, opacity: 1 }

  const c = resolvePaintUrlColor(paint, defs, currentColor) ?? paint.color
  return {
    paint: c ? colorToHex(c) : undefined,
    opacity: clamp01(paint.opacity ?? 1),
  }
}

function resolveGradientPaint(
  url: string,
  defs: SvgDefs,
  objectBounds: CoordBounds | null,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): GradientPaint | null {
  const gradient = defs.gradients.get(url)
  if (!gradient || gradient.stops.length === 0) return null
  if (gradient.type === 'linearGradient') {
    return resolveLinearGradientPaint(gradient, objectBounds, matrix, ctx)
  }
  return resolveRadialGradientPaint(gradient, objectBounds, matrix, ctx)
}

function resolveLinearGradientPaint(
  gradient: SvgLinearGradient,
  objectBounds: CoordBounds | null,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): LinearGradientPaint | null {
  const g0 = { x: gradient.x1, y: gradient.y1 }
  const g1 = { x: gradient.x2, y: gradient.y2 }
  const vx = g1.x - g0.x
  const vy = g1.y - g0.y
  const vLen2 = vx * vx + vy * vy
  if (!(vLen2 > 1e-12)) return null

  const sourceToOutput = composeLinearGradientSourceToOutputMatrix(gradient, objectBounds, matrix, ctx)
  if (!sourceToOutput) return null
  const a = sourceToOutput[0]
  const b = sourceToOutput[1]
  const c = sourceToOutput[2]
  const d = sourceToOutput[3]
  const invLen2 = 1 / vLen2
  // T = dot(v, p - g0) / |v|^2 to function.
  // A^T n = v / |v|^2 n.A with minimum.
  
  
  const normal = solveLinearGradientNormal(a, b, c, d, vx * invLen2, vy * invLen2)
  if (!normal) return null
  const nx = normal.x
  const ny = normal.y
  const nLen2 = nx * nx + ny * ny
  if (!(nLen2 > 1e-18)) return null

  const p0 = applyOptionalMatrix(g0.x, g0.y, sourceToOutput)
  const p1 = {
    x: p0.x + nx / nLen2,
    y: p0.y + ny / nLen2,
  }

  return {
    type: 'linear-gradient',
    x1: p0.x,
    y1: p0.y,
    x2: p1.x,
    y2: p1.y,
    stops: toGradientStops(gradient.stops, ctx),
    spreadMethod: gradient.spreadMethod,
  }
}

function composeLinearGradientSourceToOutputMatrix(
  gradient: SvgLinearGradient,
  objectBounds: CoordBounds | null,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): SvgMatrix | null {
  const viewportMatrix: SvgMatrix = [ctx.scaleX, 0, 0, ctx.scaleY, ctx.translateX, ctx.translateY]
  const localToOutput = multiplyMatrix(viewportMatrix, matrix)
  const identity: SvgMatrix = [1, 0, 0, 1, 0, 0]

  if (gradient.gradientUnits === 'objectBoundingBox') {
    if (!objectBounds) return null
    const bboxMatrix: SvgMatrix = [
      objectBounds.width, 0,
      0, objectBounds.height,
      objectBounds.minX, objectBounds.minY,
    ]
    const sourceToLocal = gradient.gradientTransform
      ? multiplyMatrix(bboxMatrix, gradient.gradientTransform)
      : bboxMatrix
    return multiplyMatrix(localToOutput, sourceToLocal)
  }

  const sourceToLocal = gradient.gradientTransform ?? identity
  return multiplyMatrix(localToOutput, sourceToLocal)
}

function solveLinearGradientNormal(
  a: number,
  b: number,
  c: number,
  d: number,
  rx: number,
  ry: number,
): { x: number, y: number } | null {
  // Solve M n = r where M = A^T = [[a,b],[c,d]].
  const det = a * d - b * c
  const maxAbs = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), 1)
  const detEps = 1e-12 * maxAbs * maxAbs
  if (Math.abs(det) > detEps) {
    const invDet = 1 / det
    return {
      x: (d * rx - b * ry) * invDet,
      y: (-c * rx + a * ry) * invDet,
    }
  }

  // Rank-deficient case: use minimum-norm solution when system is consistent.
  const row1Norm2 = a * a + b * b
  const row2Norm2 = c * c + d * d
  if (row1Norm2 <= 1e-18 && row2Norm2 <= 1e-18) return null

  let ux = a
  let uy = b
  let us = rx
  let vx = c
  let vy = d
  let vs = ry
  if (row2Norm2 > row1Norm2) {
    ux = c
    uy = d
    us = ry
    vx = a
    vy = b
    vs = rx
  }

  const uNorm2 = ux * ux + uy * uy
  if (uNorm2 <= 1e-18) return null

  const k = (vx * ux + vy * uy) / uNorm2
  const perpX = vx - k * ux
  const perpY = vy - k * uy
  const perpNorm = Math.hypot(perpX, perpY)
  const rowScale = Math.max(Math.hypot(ux, uy), Math.hypot(vx, vy), 1)
  if (perpNorm > 1e-12 * rowScale) {
    // Numerically near-singular but effectively full-rank; stabilized least-squares.
    const m00 = a * a + c * c
    const m01 = a * b + c * d
    const m11 = b * b + d * d
    const rhsX = a * rx + c * ry
    const rhsY = b * rx + d * ry
    const lambda = 1e-12 * (m00 + m11 + 1)
    const s00 = m00 + lambda
    const s11 = m11 + lambda
    const sDet = s00 * s11 - m01 * m01
    if (Math.abs(sDet) <= 1e-24) return null
    const invSDet = 1 / sDet
    return {
      x: (s11 * rhsX - m01 * rhsY) * invSDet,
      y: (-m01 * rhsX + s00 * rhsY) * invSDet,
    }
  }

  const expectedVs = k * us
  const rhsScale = Math.max(Math.abs(vs), Math.abs(expectedVs), 1)
  if (Math.abs(vs - expectedVs) > 1e-10 * rhsScale) return null

  const factor = us / uNorm2
  return {
    x: ux * factor,
    y: uy * factor,
  }
}

function resolveRadialGradientPaint(
  gradient: SvgRadialGradient,
  objectBounds: CoordBounds | null,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): RadialGradientPaint | null {
  let c: { x: number, y: number }
  let f: { x: number, y: number }
  let edge: { x: number, y: number }

  if (gradient.gradientUnits === 'objectBoundingBox') {
    if (!objectBounds) return null
    const cNorm = applyOptionalMatrix(gradient.cx, gradient.cy, gradient.gradientTransform)
    const fNorm = applyOptionalMatrix(gradient.fx, gradient.fy, gradient.gradientTransform)
    const eNorm = applyOptionalMatrix(gradient.cx + gradient.r, gradient.cy, gradient.gradientTransform)
    const cLocal = { x: objectBounds.minX + cNorm.x * objectBounds.width, y: objectBounds.minY + cNorm.y * objectBounds.height }
    const fLocal = { x: objectBounds.minX + fNorm.x * objectBounds.width, y: objectBounds.minY + fNorm.y * objectBounds.height }
    const eLocal = { x: objectBounds.minX + eNorm.x * objectBounds.width, y: objectBounds.minY + eNorm.y * objectBounds.height }
    c = transformPoint(cLocal.x, cLocal.y, matrix, ctx)
    f = transformPoint(fLocal.x, fLocal.y, matrix, ctx)
    edge = transformPoint(eLocal.x, eLocal.y, matrix, ctx)
  } else {
    const cUser = applyOptionalMatrix(gradient.cx, gradient.cy, gradient.gradientTransform)
    const fUser = applyOptionalMatrix(gradient.fx, gradient.fy, gradient.gradientTransform)
    const eUser = applyOptionalMatrix(gradient.cx + gradient.r, gradient.cy, gradient.gradientTransform)
    c = transformPoint(cUser.x, cUser.y, matrix, ctx)
    f = transformPoint(fUser.x, fUser.y, matrix, ctx)
    edge = transformPoint(eUser.x, eUser.y, matrix, ctx)
  }

  const r = Math.hypot(edge.x - c.x, edge.y - c.y)
  if (!(r > 1e-6)) return null

  return {
    type: 'radial-gradient',
    cx: c.x,
    cy: c.y,
    r,
    fx: f.x,
    fy: f.y,
    fr: 0,
    stops: toGradientStops(gradient.stops, ctx),
    spreadMethod: gradient.spreadMethod,
  }
}

function applyOptionalMatrix(
  x: number,
  y: number,
  matrix?: SvgMatrix,
): { x: number, y: number } {
  if (!matrix) return { x, y }
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  }
}

function toGradientStops(stops: SvgGradientStop[], ctx: SvgRenderContext): GradientStop[] {
  const normalized = normalizeStops(stops)
  const out: GradientStop[] = []
  for (let i = 0; i < normalized.length; i++) {
    const s = normalized[i]!
    const palette = resolveSvgPaletteColor(s.paletteIndex, ctx)
    out.push({
      offset: s.offset,
      color: colorToHex(palette ?? s.color),
      opacity: clamp01(s.opacity * (palette ? (palette.a ?? 255) / 255 : 1)),
    })
  }
  return out
}

function resolveSvgPaletteColor(index: number | undefined, ctx: SvgRenderContext): SvgColor | null {
  if (index === undefined || !ctx.paletteFont) return null
  return ctx.paletteFont.getColorFromSelectedPalette(index)
}

function parseRendererColor(value: string): SvgColor {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) return { r: Number.parseInt(hex[1]!.slice(0, 2), 16), g: Number.parseInt(hex[1]!.slice(2, 4), 16), b: Number.parseInt(hex[1]!.slice(4, 6), 16) }
  return { r: 0, g: 0, b: 0 }
}

function isGradientPaint(paint: PaintValue | undefined): paint is GradientPaint {
  return !!paint && typeof paint !== 'string'
}

function resolveTextFillColor(style: SvgStyle, defs: SvgDefs): string | null {
  const fill = style.fill
  const currentColor = style.color ?? { r: 0, g: 0, b: 0 }
  if (!fill) return '#000000'
  if (fill.type === 'none') return null
  if (fill.type === 'currentColor') return colorToHex(currentColor)
  if (fill.type === 'color') {
    if ((fill.opacity ?? 1) <= 0) return null
    return colorToHex(fill.color ?? { r: 0, g: 0, b: 0 })
  }
  const c = resolvePaintUrlColor(fill, defs, currentColor) ?? fill.color
  return c ? colorToHex(c) : null
}

function normalizeSvgText(text: string): string {
  return text.replace(/[\t\r\n ]+/g, ' ').trim()
}

function extractFontId(fontFamily: string | undefined): string {
  if (!fontFamily) return 'default'
  const first = fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '')
  if (!first) return 'default'
  const generic = first.toLowerCase()
  if (
    generic === 'serif' ||
    generic === 'sans-serif' ||
    generic === 'monospace' ||
    generic === 'cursive' ||
    generic === 'fantasy' ||
    generic === 'system-ui'
  ) {
    return 'default'
  }
  return first

}

function resolvePaintUrlColor(paint: SvgPaint, _defs: SvgDefs, currentColor: SvgColor): SvgColor | null {
  if (paint.type !== 'url' || !paint.url) return null
  if (paint.fallbackCurrentColor) return currentColor
  return null
}

function normalizeDashArray(dash: number[] | undefined): number[] | undefined {
  if (!dash || dash.length === 0) return undefined
  const cleaned = dash.filter(v => Number.isFinite(v) && v > 0)
  if (cleaned.length === 0) return undefined
  // SVG requires odd-length dash arrays to be repeated to make an even-length array.
  return cleaned.length % 2 === 1 ? cleaned.concat(cleaned) : cleaned
}

function normalizeStops(stops: SvgGradientStop[]): SvgGradientStop[] {
  const normalized: SvgGradientStop[] = []
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
      opacity: clamp01(s.opacity),
      paletteIndex: s.paletteIndex,
    })
  }
  if (normalized.length === 0) {
    return [{ offset: 0, color: { r: 0, g: 0, b: 0 }, opacity: 1 }]
  }
  if (normalized[0]!.offset > 0) {
    const first = normalized[0]!
    normalized.unshift({ offset: 0, color: first.color, opacity: first.opacity, paletteIndex: first.paletteIndex })
  }
  if (normalized[normalized.length - 1]!.offset < 1) {
    const last = normalized[normalized.length - 1]!
    normalized.push({ offset: 1, color: last.color, opacity: last.opacity, paletteIndex: last.paletteIndex })
  }
  return normalized
}

function mergeStyle(parent: SvgStyle, own: SvgStyle): SvgStyle {
  const merged: SvgStyle = { ...parent, ...own }
  merged.opacity = own.opacity
  merged.display = own.display
  merged.vectorEffect = own.vectorEffect
  merged.enableBackground = own.enableBackground
  merged.overflow = own.overflow
  return merged
}

interface ParsedEnableBackground {
  mode: 'accumulate' | 'new'
  x?: number
  y?: number
  width?: number
  height?: number
}

function parseEnableBackground(value: string | undefined): ParsedEnableBackground {
  if (value === undefined || value.trim() === '' || value.trim() === 'accumulate') return { mode: 'accumulate' }
  const parts = value.trim().split(/[\s,]+/)
  if (parts[0] !== 'new' || (parts.length !== 1 && parts.length !== 5)) throw new Error(`Invalid SVG enable-background value "${value}"`)
  if (parts.length === 1) return { mode: 'new' }
  const x = Number(parts[1])
  const y = Number(parts[2])
  const width = Number(parts[3])
  const height = Number(parts[4])
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) throw new Error(`Invalid SVG enable-background region "${value}"`)
  return { mode: 'new', x, y, width, height }
}

function resolveEnableBackgroundRegion(
  value: ParsedEnableBackground,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): PathData | undefined {
  if (value.x === undefined) return undefined
  const path = transformPathByMatrix(
    new Uint8Array([0, 1, 1, 1, 3]),
    new Float32Array([
      value.x, value.y!,
      value.x + value.width!, value.y!,
      value.x + value.width!, value.y! + value.height!,
      value.x, value.y! + value.height!,
    ]),
    matrix,
  )
  return applyViewportToPathData(path, ctx)
}

function colorToHex(c: SvgColor): string {
  const r = c.r.toString(16).padStart(2, '0')
  const g = c.g.toString(16).padStart(2, '0')
  const b = c.b.toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

function clamp01(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

// Utilities.

function transformPoint(x: number, y: number, matrix: SvgMatrix, ctx: SvgRenderContext): { x: number, y: number } {
  const wx = matrix[0] * x + matrix[2] * y + matrix[4]
  const wy = matrix[1] * x + matrix[3] * y + matrix[5]
  return {
    x: wx * ctx.scaleX + ctx.translateX,
    y: wy * ctx.scaleY + ctx.translateY,
  }
}

function approxMatrixScale(matrix: SvgMatrix): number {
  const sx = Math.hypot(matrix[0], matrix[1])
  const sy = Math.hypot(matrix[2], matrix[3])
  return (sx + sy) * 0.5
}

function approxRenderScale(matrix: SvgMatrix, ctx: SvgRenderContext): number {
  const viewportScale = (Math.abs(ctx.scaleX) + Math.abs(ctx.scaleY)) * 0.5
  return approxMatrixScale(matrix) * viewportScale
}

function resolveStrokeRenderScale(
  style: SvgStyle,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): number {
  if (style.vectorEffect === 'non-scaling-stroke') return 1
  return approxRenderScale(matrix, ctx)
}

function resolveStrokeRenderWidth(
  style: SvgStyle,
  matrix: SvgMatrix,
  ctx: SvgRenderContext,
): number {
  return (style.strokeWidth ?? 1) * resolveStrokeRenderScale(style, matrix, ctx)
}

function resolveStrokeBoundsScale(style: SvgStyle, matrix: SvgMatrix): number {
  if (style.vectorEffect === 'non-scaling-stroke') return 1
  return approxMatrixScale(matrix)
}

function approxRenderScaleX(matrix: SvgMatrix, ctx: SvgRenderContext): number {
  const mx = Math.hypot(matrix[0], matrix[1])
  return mx * Math.abs(ctx.scaleX)
}

function approxRenderScaleY(matrix: SvgMatrix, ctx: SvgRenderContext): number {
  const my = Math.hypot(matrix[2], matrix[3])
  return my * Math.abs(ctx.scaleY)
}

function resolveViewportTransform(doc: SvgDocument, width: number, height: number): ViewportTransform {
  return computeViewBoxToViewportTransform(doc.viewBox, width, height, doc.preserveAspectRatio)
}

function computeViewBoxToViewportTransform(
  viewBox: { x: number, y: number, width: number, height: number },
  viewportWidth: number,
  viewportHeight: number,
  preserveAspectRatio: string,
): ViewportTransform {
  // Guard zero and non-finite viewBox extents (e.g. a malformed viewBox that
  // parsed to NaN): fall back to scale 1 so a NaN scale cannot propagate through
  // the whole transform and blank out the rendering.
  const rawSx = viewBox.width === 0 || !Number.isFinite(viewBox.width) ? 1 : viewportWidth / viewBox.width
  const rawSy = viewBox.height === 0 || !Number.isFinite(viewBox.height) ? 1 : viewportHeight / viewBox.height
  const parsed = parsePreserveAspectRatio(preserveAspectRatio)
  if (parsed.align === 'none') {
    return {
      scaleX: rawSx,
      scaleY: rawSy,
      translateX: -viewBox.x * rawSx,
      translateY: -viewBox.y * rawSy,
    }
  }

  const uniform = parsed.meetOrSlice === 'slice'
    ? Math.max(rawSx, rawSy)
    : Math.min(rawSx, rawSy)
  const usedW = viewBox.width * uniform
  const usedH = viewBox.height * uniform

  let offsetX = 0
  let offsetY = 0
  if (parsed.align.includes('xMid')) offsetX = (viewportWidth - usedW) * 0.5
  else if (parsed.align.includes('xMax')) offsetX = viewportWidth - usedW
  if (parsed.align.includes('YMid')) offsetY = (viewportHeight - usedH) * 0.5
  else if (parsed.align.includes('YMax')) offsetY = viewportHeight - usedH

  return {
    scaleX: uniform,
    scaleY: uniform,
    translateX: offsetX - viewBox.x * uniform,
    translateY: offsetY - viewBox.y * uniform,
  }
}

function parsePreserveAspectRatio(s: string): { align: string, meetOrSlice: 'meet' | 'slice' } {
  const raw = (s || '').trim()
  if (!raw) return { align: 'xMidYMid', meetOrSlice: 'meet' }
  const parts = raw.split(/\s+/).filter(Boolean)
  let align = parts[0] ?? 'xMidYMid'
  let meetOrSlice: 'meet' | 'slice' = 'meet'
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!
    if (p === 'meet' || p === 'slice') meetOrSlice = p
  }
  if (align === 'defer' && parts.length >= 2) {
    align = parts[1]!
  }
  if (!/^(none|x(Min|Mid|Max)Y(Min|Mid|Max))$/.test(align)) {
    align = 'xMidYMid'
  }
  return { align, meetOrSlice }
}

interface IntrinsicImageSize {
  width: number
  height: number
}

interface ImageDestBox {
  x: number
  y: number
  width: number
  height: number
  clipViewport: boolean
}

interface ImageAffine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

function inferIntrinsicImageSize(
  node: SvgImage,
  embedded: { data: Uint8Array, mimeType?: string } | null,
): IntrinsicImageSize | null {
  if (!embedded) return null
  const mime = (embedded.mimeType ?? '').toLowerCase()
  if (mime.includes('svg')) {
    try {
      const doc = parseSvg(embedded.data)
      const w = doc.width > 0 ? doc.width : doc.viewBox.width
      const h = doc.height > 0 ? doc.height : doc.viewBox.height
      if (w > 0 && h > 0) return { width: w, height: h }
      return null
    } catch {
      return null
    }
  }
  const fmt = detectImageFormat(embedded.data)
  if (fmt === 'png' || fmt === 'jpeg' || fmt === 'webp' || fmt === 'avif') {
    const dims = getImageDimensions(embedded.data)
    if (dims && dims.width > 0 && dims.height > 0) return dims
    return null
  }
  // Intrinsic size cannot be inferred for external references or unknown formats.
  const fallbackRatio = node.width > 0 && node.height > 0
    ? { width: node.width, height: node.height }
    : null
  return fallbackRatio
}

function resolveImageDestBox(node: SvgImage, intrinsic: IntrinsicImageSize | null): ImageDestBox {
  const viewportW = node.width
  const viewportH = node.height
  if (!(viewportW > 0) || !(viewportH > 0)) {
    return { x: node.x, y: node.y, width: 0, height: 0, clipViewport: false }
  }

  const par = parsePreserveAspectRatio(node.preserveAspectRatio ?? 'xMidYMid meet')
  if (par.align === 'none' || !intrinsic || !(intrinsic.width > 0) || !(intrinsic.height > 0)) {
    return { x: node.x, y: node.y, width: viewportW, height: viewportH, clipViewport: false }
  }

  const scale = par.meetOrSlice === 'slice'
    ? Math.max(viewportW / intrinsic.width, viewportH / intrinsic.height)
    : Math.min(viewportW / intrinsic.width, viewportH / intrinsic.height)
  const usedW = intrinsic.width * scale
  const usedH = intrinsic.height * scale

  let offsetX = 0
  let offsetY = 0
  if (par.align.includes('xMid')) offsetX = (viewportW - usedW) * 0.5
  else if (par.align.includes('xMax')) offsetX = viewportW - usedW
  if (par.align.includes('YMid')) offsetY = (viewportH - usedH) * 0.5
  else if (par.align.includes('YMax')) offsetY = viewportH - usedH

  const eps = 1e-6
  const clipViewport = par.meetOrSlice === 'slice' && (usedW > viewportW + eps || usedH > viewportH + eps)
  return {
    x: node.x + offsetX,
    y: node.y + offsetY,
    width: usedW,
    height: usedH,
    clipViewport,
  }
}

function toImageAffineFromRect(
  p0: { x: number, y: number },
  vx: { x: number, y: number },
  vy: { x: number, y: number },
): ImageAffine {
  return {
    a: vx.x,
    b: vx.y,
    c: -vy.x,
    d: -vy.y,
    e: p0.x + vy.x,
    f: p0.y + vy.y,
  }
}

function tryAxisAlignedRectFromAffine(
  affine: ImageAffine,
): { x: number, y: number, width: number, height: number } | null {
  const eps = 1e-6
  if (Math.abs(affine.b) > eps || Math.abs(affine.c) > eps) return null
  const x0 = Math.min(affine.e, affine.e + affine.a)
  const x1 = Math.max(affine.e, affine.e + affine.a)
  const y0 = Math.min(affine.f, affine.f + affine.d)
  const y1 = Math.max(affine.f, affine.f + affine.d)
  const width = x1 - x0
  const height = y1 - y0
  if (!(width > 0) || !(height > 0)) return null
  return { x: x0, y: y0, width, height }
}

function parseDataUri(href: string): { data: Uint8Array, mimeType?: string } | null {
  const m = href.match(/^data:([^;,]+)?(?:;(base64))?,(.*)$/i)
  if (!m) return null
  const mimeType = m[1] ? m[1].toLowerCase() : undefined
  const isBase64 = !!m[2]
  const payload = m[3] ?? ''

  if (isBase64) {
    return { data: decodeBase64(payload), mimeType }
  }
  const decoded = decodeURIComponent(payload.replace(/\+/g, '%20'))
  return { data: new TextEncoder().encode(decoded), mimeType }
}

function resolveSvgImageResource(
  href: string,
  ctx: SvgRenderContext,
): { data: Uint8Array, mimeType?: string } | null {
  const embedded = parseDataUri(href)
  if (embedded !== null) return embedded
  return ctx.imageResources?.get(href) ?? null
}

function decodeBase64(input: string): Uint8Array {
  const g = globalThis as unknown as { atob?: (s: string) => string, Buffer?: { from: (s: string, encoding: string) => Uint8Array } }
  if (g.Buffer) {
    return new Uint8Array(g.Buffer.from(input, 'base64'))
  }
  if (g.atob) {
    const bin = g.atob(input)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xFF
    return out
  }
  throw new Error('Base64 decoder is not available in this runtime')
}

function multiplyMatrix(a: SvgMatrix, b: SvgMatrix): SvgMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

function roundedRectToPath(
  x: number, y: number, w: number, h: number,
  rx: number, ry: number,
): { commands: Uint8Array, coords: Float32Array } {
  rx = Math.min(rx, w / 2)
  ry = Math.min(ry, h / 2)
  const k = 0.5522847498

  const cmds = new Uint8Array([
    0, // M
    1, 2, // top-right corner
    1, 2, // bottom-right corner
    1, 2, // bottom-left corner
    1, 2, // top-left corner
    3, // Z
  ])

  const cds = new Float32Array([
    // M: start of top edge
    x + rx, y,
    // L: end of top edge
    x + w - rx, y,
    // C: top-right corner
    x + w - rx + rx * k, y, x + w, y + ry - ry * k, x + w, y + ry,
    // L: end of right edge
    x + w, y + h - ry,
    // C: bottom-right corner
    x + w, y + h - ry + ry * k, x + w - rx + rx * k, y + h, x + w - rx, y + h,
    // L: end of bottom edge
    x + rx, y + h,
    // C: bottom-left corner
    x + rx - rx * k, y + h, x, y + h - ry + ry * k, x, y + h - ry,
    // L: end of left edge
    x, y + ry,
    // C: top-left corner
    x, y + ry - ry * k, x + rx - rx * k, y, x + rx, y,
  ])

  return { commands: cmds, coords: cds }
}

function ellipseToPath(
  cx: number, cy: number, rx: number, ry: number,
): [Uint8Array, Float32Array] {
  // Approximate the ellipse with four cubic Bezier segments.
  const k = 0.5522847498
  const kx = rx * k
  const ky = ry * k
  const commands = new Uint8Array([0, 2, 2, 2, 2, 3]) // M C C C C Z
  const coords = new Float32Array([
    cx - rx, cy,                                                          // M
    cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry,                     // C
    cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy,                     // C
    cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry,                     // C
    cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy,                     // C
  ])
  return [commands, coords]
}
