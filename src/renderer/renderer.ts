/**
 * Shared renderer (tree walker)
 *
 * Recursively traverses RenderDocument / RenderPage and
 * converts them into RenderBackend primitives.
 * The output target (PDF / Canvas, etc.) is switched via the backend.
 */

import type { RenderBackend, LinkAnnotation, BookmarkEntry, AnchorEntry, PaintValue } from './backend.js'
import type {
  RenderDocument, RenderPage, RenderNode,
  RenderGroup, RenderText, RenderLine,
  RenderRect, RenderEllipse, RenderPath, RenderImage,
  RenderSvg, RenderLink,
} from '../types/render.js'
import { PdfBackend, type PdfBackendOptions } from './pdf-backend.js'
import { rectToPath, ellipseToPath } from './shape-path.js'

/**
 * Render the entire document
 * Full lifecycle including beginDocument / endDocument.
 */
export function render(doc: RenderDocument, backend: RenderBackend): void {
  backend.beginDocument()

  // Tagged PDF mode
  if (doc.tagged && backend.setTagged) {
    backend.setTagged(doc.lang, doc.roleMap, doc.structureNamespaces, doc.pronunciationLexiconFileIndexes)
  }

  // Pass image resources
  if (backend.setImages && doc.images) {
    backend.setImages(doc.images)
  }

  // Pass bookmark/anchor information upfront
  if (backend.setBookmarks && doc.bookmarks) {
    const bookmarkEntries: BookmarkEntry[] = []
    for (let i = 0; i < doc.bookmarks.length; i++) {
      const b = doc.bookmarks[i]!
      bookmarkEntries.push({ label: b.label, level: b.level, pageIndex: b.pageIndex, y: b.y })
    }
    backend.setBookmarks(bookmarkEntries)
  }
  if (backend.setAnchors && doc.anchors) {
    const entries: AnchorEntry[] = []
    for (const [name, info] of doc.anchors) {
      entries.push({ name, pageIndex: info.pageIndex, y: info.y })
    }
    backend.setAnchors(entries)
  }

  for (let pageIdx = 0; pageIdx < doc.pages.length; pageIdx++) {
    renderPageContent(doc.pages[pageIdx]!, backend, pageIdx)
  }
  backend.endDocument()
}

/**
 * Render a single page
 * Used when drawing just one page, e.g. in the editor.
 * Does not call beginDocument / endDocument.
 */
export function renderPage(page: RenderPage, backend: RenderBackend): void {
  renderPageContent(page, backend, 0)
}

/**
 * Convert a RenderDocument into PDF bytes.
 * Convenience API bundling PdfBackend creation → render → toUint8Array into a single call.
 */
export function renderToPdf(doc: RenderDocument, options: PdfBackendOptions): Uint8Array {
  const backend = new PdfBackend(options)
  render(doc, backend)
  return backend.toUint8Array()
}

// ─── Internal ───

function renderPageContent(page: RenderPage, backend: RenderBackend, pageIndex: number): void {
  backend.beginPage(page.width, page.height, page.transparencyGroup === undefined ? undefined : { transparencyGroup: page.transparencyGroup })
  for (let i = 0; i < page.children.length; i++) {
    const node = page.children[i]!
    const cached = backend.beginContentGroup?.(node, i, page) === true
    const pageTransparencyObject = page.transparencyGroup !== undefined
      && backend.beginTransparencyObject !== undefined
      && backend.endTransparencyObject !== undefined
    if (!cached) {
      if (pageTransparencyObject) backend.beginTransparencyObject!(node)
      renderNode(node, backend, 0, 0, pageIndex, page.height)
      if (pageTransparencyObject) backend.endTransparencyObject!()
    }
    if (backend.endContentGroup) backend.endContentGroup()
  }
  backend.endPage()
}

function renderNode(
  node: RenderNode, backend: RenderBackend,
  absX: number, absY: number,
  pageIndex: number, pageHeight: number,
): void {
  if (
    node.alphaIsShape === undefined
    && node.textKnockout === undefined
    && (node.type === 'formField' || (
      node.blendMode === undefined
      && node.overprintFill === undefined
      && node.overprintStroke === undefined
      && node.overprintMode === undefined
      && node.renderingIntent === undefined
      && node.tag === undefined
      && (node.type !== 'group' || node.optionalContent === undefined)
    ))
  ) {
    renderNodeContent(node, backend, absX, absY, pageIndex, pageHeight)
    return
  }

  const decorated = node.type === 'formField' ? null : node
  const blendMode = decorated?.blendMode
  const blended = blendMode !== undefined
  const overprintFill = decorated?.overprintFill
  const overprintStroke = decorated?.overprintStroke
  const overprintMode = decorated?.overprintMode
  const overprint = overprintFill !== undefined || overprintStroke !== undefined || overprintMode !== undefined
  const renderingIntent = decorated?.renderingIntent
  const alphaIsShape = node.alphaIsShape
  const textKnockout = node.textKnockout
  const transparencyParameters = alphaIsShape !== undefined || textKnockout !== undefined
  const scopedState = blended || overprint || renderingIntent !== undefined || transparencyParameters
  if (scopedState) backend.save()
  if (blended) {
    if (!backend.setBlendMode) throw new Error('Render backend does not support blend modes')
    backend.setBlendMode(blendMode)
  }
  if (overprint) {
    if (!backend.setOverprint) throw new Error('Render backend does not support overprint')
    backend.setOverprint(overprintFill === true, overprintStroke === true, overprintMode ?? 0)
  }
  if (renderingIntent !== undefined && backend.setRenderingIntent) {
    backend.setRenderingIntent(renderingIntent)
  }
  if (transparencyParameters) {
    if (backend.setTransparencyParameters === undefined) throw new Error('Render backend does not support alpha-source and text-knockout parameters')
    backend.setTransparencyParameters(alphaIsShape, textKnockout)
  }

  const optionalContent = node.type === 'group' ? node.optionalContent : undefined
  if (optionalContent?.visible === false && backend.beginOptionalContent === undefined) {
    if (scopedState) backend.restore()
    return
  }
  if (optionalContent && backend.beginOptionalContent) {
    backend.beginOptionalContent(optionalContent)
  }

  // Tagged PDF: wrap tagged content
  const tag = decorated?.tag
  if (tag && backend.beginTaggedContent) {
    backend.beginTaggedContent(tag)
  }

  const captureOverprint = overprint
    && backend.beginOverprintObject !== undefined
    && backend.endOverprintObject !== undefined
  if (captureOverprint) backend.beginOverprintObject!()

  renderNodeContent(node, backend, absX, absY, pageIndex, pageHeight)

  if (captureOverprint) backend.endOverprintObject!()

  if (tag && backend.endTaggedContent) {
    backend.endTaggedContent()
  }
  if (optionalContent && backend.endOptionalContent) {
    backend.endOptionalContent()
  }
  if (scopedState) backend.restore()
}

function renderNodeContent(
  node: RenderNode, backend: RenderBackend,
  absX: number, absY: number,
  pageIndex: number, pageHeight: number,
): void {
  switch (node.type) {
    case 'group':
      renderGroup(node, backend, absX, absY, pageIndex, pageHeight)
      break
    case 'text':
      renderText(node, backend, absX, absY, pageIndex, pageHeight)
      break
    case 'line':
      renderLine(node, backend)
      break
    case 'rect':
      renderRect(node, backend)
      break
    case 'formField':
      if (!backend.drawFormField) throw new Error('Render backend does not support form fields')
      backend.drawFormField(node.x + absX, node.y + absY, node.width, node.height, node)
      break
    case 'ellipse':
      renderEllipse(node, backend)
      break
    case 'path':
      renderPath(node, backend)
      break
    case 'image':
      renderImage(node, backend, absX, absY, pageIndex, pageHeight)
      break
    case 'svg':
      renderSvgNode(node as RenderSvg, backend)
      break
  }
}

function renderGroup(
  group: RenderGroup, backend: RenderBackend,
  absX: number, absY: number,
  pageIndex: number, pageHeight: number,
): void {
  backend.save()

  if (group.pdfForm !== undefined && backend.beginPdfForm !== undefined && backend.endPdfForm !== undefined) {
    backend.translate(group.x, group.y)
    if (group.affineTransform !== undefined) {
      if (backend.transform === undefined) throw new Error('Render backend does not support affine group transforms')
      backend.transform(...group.affineTransform)
    }
    // Imported Form opacity belongs to the Form invocation, not to each
    // child paint.  Emit it before beginPdfForm switches the backend into the
    // Form's definition stream, so the completed XObject is composited once.
    if (group.opacity !== undefined && group.opacity < 1) backend.setOpacity(group.opacity)
    backend.beginPdfForm(group.pdfForm)
    for (let i = 0; i < group.children.length; i++) {
      renderNode(group.children[i]!, backend, absX, absY, pageIndex, pageHeight)
    }
    backend.endPdfForm()
    backend.restore()
    return
  }

  backend.translate(group.x, group.y)

  const newAbsX = absX + group.x
  const newAbsY = absY + group.y

  if (group.affineTransform !== undefined) {
    if (backend.transform === undefined) throw new Error('Render backend does not support affine group transforms')
    backend.transform(...group.affineTransform)
  }

  if (group.rotation) {
    const originX = group.rotationOriginX ?? 0
    const originY = group.rotationOriginY ?? 0
    backend.translate(originX, originY)
    backend.rotate(group.rotation)
    backend.translate(-originX, -originY)
  }

  // Device print-production parameters (PDF ExtGState /TR /BG /UCR /HT).
  const deviceLayer = group.deviceParams !== undefined && backend.beginDeviceParams !== undefined
  if (group.deviceParams) {
    if (deviceLayer) backend.beginDeviceParams!(group.deviceParams)
    else if (backend.setDeviceParams) backend.setDeviceParams(group.deviceParams)
  }

  // A transparency group (PDF /Group /S /Transparency) is required when the
  // group is isolated/knockout or carries a soft mask: children are composited
  // as a unit before opacity/mask is applied. The group's blend/overprint are
  // already active via the renderNode wrapper, so they apply to the composite.
  const useTransparencyGroup =
    (group.transparencyGroup === true || group.isolated === true || group.knockout === true || group.softMask !== undefined || (group.opacity !== undefined && group.opacity < 1))
    && backend.beginTransparencyGroup !== undefined
    && !(backend.directSinglePaintGroupOpacity === true && canApplyGroupOpacityToSinglePaint(group))

  if (useTransparencyGroup) {
    if (group.softMask) {
      if (!backend.beginSoftMask || !backend.endSoftMask) {
        throw new Error('Render backend does not support soft masks')
      }
      backend.beginSoftMask(group.softMask.type, group.width, group.height, group.softMask.backdrop, group.softMask.transferFunction, undefined, undefined, group.softMask.colorSpace, group.softMask.isolated, group.softMask.knockout)
      applyGroupClip(group, backend)
      for (let i = 0; i < group.softMask.content.length; i++) {
        renderNode(group.softMask.content[i]!, backend, newAbsX, newAbsY, pageIndex, pageHeight)
      }
      backend.endSoftMask()
    }
    backend.beginTransparencyGroup!(group.width, group.height, {
      isolated: group.isolated === true,
      knockout: group.knockout === true,
      opacity: group.opacity,
      hasSoftMask: group.softMask !== undefined,
    })
    applyGroupClip(group, backend)
    if (group.link && backend.addAnnotation) {
      emitLinkAnnotation(backend, group.link, newAbsX, newAbsY, group.width, group.height, pageIndex, pageHeight)
    }
    for (let i = 0; i < group.children.length; i++) {
      if (backend.beginTransparencyObject !== undefined) backend.beginTransparencyObject(group.children[i]!)
      renderNode(group.children[i]!, backend, newAbsX, newAbsY, pageIndex, pageHeight)
      if (backend.endTransparencyObject !== undefined) backend.endTransparencyObject()
    }
    backend.endTransparencyGroup!()
    if (deviceLayer) backend.endDeviceParams!()
    backend.restore()
    return
  }

  applyGroupClip(group, backend)

  if (group.opacity != null && group.opacity < 1.0) {
    backend.setOpacity(group.opacity)
  }

  // Group-level link annotation
  if (group.link && backend.addAnnotation) {
    emitLinkAnnotation(backend, group.link, newAbsX, newAbsY, group.width, group.height, pageIndex, pageHeight)
  }

  for (let i = 0; i < group.children.length; i++) {
    renderNode(group.children[i]!, backend, newAbsX, newAbsY, pageIndex, pageHeight)
  }

  if (deviceLayer) backend.endDeviceParams!()
  backend.restore()
}

/**
 * A constant-alpha group containing one solid paint has the same compositing
 * result when its alpha is applied directly to that paint. Avoiding an
 * offscreen transparency surface is important for imported documents that
 * wrap thousands of individual vector marks in one-child opacity groups.
 */
function canApplyGroupOpacityToSinglePaint(group: RenderGroup): boolean {
  if (group.opacity === undefined || group.opacity >= 1) return false
  if (group.transparencyGroup === true || group.isolated === true || group.knockout === true || group.softMask !== undefined) return false
  return group.children.length === 1 && isSingleSolidPaint(group.children[0]!)
}

function isSingleSolidPaint(node: RenderNode): boolean {
  if (node.type === 'group') {
    if (node.transparencyGroup === true || node.isolated === true || node.knockout === true || node.softMask !== undefined) return false
    if (node.opacity !== undefined && node.opacity < 1) return false
    return node.children.length === 1 && isSingleSolidPaint(node.children[0]!)
  }
  if (node.type === 'line' || node.type === 'image') return true
  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'path') {
    const solidFill = typeof node.fill === 'string' && node.fill !== ''
    const solidStroke = typeof node.stroke === 'string' && node.stroke !== ''
    return solidFill !== solidStroke
  }
  return false
}

function applyGroupClip(group: RenderGroup, backend: RenderBackend): void {
  if (group.clip) backend.clip(0, 0, group.width, group.height)
  if (group.clipPath) backend.clipPath(group.clipPath.commands, group.clipPath.coords, group.clipPath.fillRule)
}

function renderText(
  node: RenderText, backend: RenderBackend,
  absX: number, absY: number,
  pageIndex: number, pageHeight: number,
): void {
  backend.drawText(
    node.x, node.y, node.text,
    node.fontId, node.fontSize, node.color,
    {
      actualText: node.actualText,
      bold: node.bold,
      italic: node.italic,
      underline: node.underline,
      strikethrough: node.strikethrough,
      hAlign: node.hAlign,
      width: node.width,
      variation: node.variation,
      writingMode: node.writingMode,
      direction: node.direction,
      glyphIds: node.glyphIds,
      outlineText: node.outlineText,
      pdfFontMode: node.pdfFontMode,
      textPaintMode: node.textPaintMode,
      textStrokeColor: node.textStrokeColor,
      textStrokeWidth: node.textStrokeWidth,
      letterSpacing: node.letterSpacing,
      horizontalScale: node.horizontalScale,
      baselineOffset: node.baselineOffset,
      glyphRun: node.glyphRun,
    },
  )

  // Text link annotation
  if (node.link && backend.addAnnotation) {
    emitLinkAnnotation(
      backend, node.link,
      absX + node.x, absY + node.y,
      node.width ?? 0, node.fontSize,
      pageIndex, pageHeight,
    )
  }
}

function renderLine(node: RenderLine, backend: RenderBackend): void {
  backend.drawLine(
    node.x1, node.y1, node.x2, node.y2,
    node.lineWidth, node.color,
    node.dash,
  )
}

function renderRect(node: RenderRect, backend: RenderBackend): void {
  if (isGradientPaintValue(node.fill)) {
    const path = rectToPath(node.x, node.y, node.width, node.height, node.radius, node.cornerRadii)
    backend.drawPathWithPaints(path.commands, path.coords, {
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
    })
    return
  }
  backend.drawRect(
    node.x, node.y, node.width, node.height,
    {
      fill: solidPaint(node.fill),
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      radius: node.radius,
      cornerRadii: node.cornerRadii,
    },
  )
}

function renderEllipse(node: RenderEllipse, backend: RenderBackend): void {
  if (isGradientPaintValue(node.fill)) {
    const path = ellipseToPath(node.cx, node.cy, node.rx, node.ry)
    backend.drawPathWithPaints(path.commands, path.coords, {
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
    })
    return
  }
  backend.drawEllipse(
    node.cx, node.cy, node.rx, node.ry,
    {
      fill: solidPaint(node.fill),
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
    },
  )
}

function renderPath(node: RenderPath, backend: RenderBackend): void {
  if (node.affineTransform !== undefined) {
    if (backend.transform === undefined) throw new Error('Render backend does not support affine path transforms')
    backend.save()
    backend.transform(...node.affineTransform)
  }
  const options = {
    fill: node.fill,
    fillRule: node.fillRule,
    fillOpacity: node.fillOpacity,
    stroke: node.stroke,
    strokeWidth: node.strokeWidth,
    strokeOpacity: node.strokeOpacity,
    strokeLinecap: node.strokeLinecap,
    strokeLinejoin: node.strokeLinejoin,
    strokeMiterLimit: node.strokeMiterLimit,
    strokeDasharray: node.strokeDasharray,
    strokeDashoffset: node.strokeDashoffset,
  }
  const source = node.pdfSourceVector
  if (source === undefined) {
    backend.drawPathWithPaints(node.commands, node.coords, options)
  } else if (backend.drawPdfSourceVector !== undefined) {
    backend.drawPdfSourceVector(source, options)
  } else {
    for (let i = 0; i < source.instances.length; i++) {
      const instance = source.instances[i]!
      const definition = source.definitions[instance.definitionIndex]
      if (definition === undefined) throw new Error(`PDF source vector definition ${instance.definitionIndex} is missing`)
      if (backend.transform === undefined) throw new Error('Render backend does not support source-vector affine instances')
      backend.save()
      backend.transform(...instance.matrix)
      backend.drawPathWithPaints(definition.commands, definition.coords, options)
      backend.restore()
    }
  }
  if (node.affineTransform !== undefined) backend.restore()
}

function renderImage(
  node: RenderImage, backend: RenderBackend,
  absX: number, absY: number,
  pageIndex: number, pageHeight: number,
): void {
  if (node.opacity != null && node.opacity < 1.0) {
    backend.save()
    backend.setOpacity(node.opacity)
    drawImageNode(node, backend)
    backend.restore()
  } else {
    drawImageNode(node, backend)
  }

  if (node.link && backend.addAnnotation) {
    emitLinkAnnotation(
      backend, node.link,
      absX + node.x, absY + node.y,
      node.width, node.height,
      pageIndex, pageHeight,
    )
  }
}

function drawImageNode(node: RenderImage, backend: RenderBackend): void {
  const options = {
    interpolate: node.interpolate, intent: node.renderingIntent, alternates: node.alternates, opi: node.opi,
    measure: node.measure, pointData: node.pointData,
  }
  if (node.affineTransform !== undefined) {
    if (!backend.drawImageAffine) throw new Error('Render backend does not support affine image drawing')
    const m = node.affineTransform
    backend.drawImageAffine(m[0], m[1], m[2], m[3], m[4], m[5], node.imageId, options)
    return
  }
  if (node.rotation) {
    backend.save()
    if (node.rotation === 90) {
      backend.translate(node.x + node.width, node.y)
      backend.rotate(90)
      backend.drawImage(0, 0, node.height, node.width, node.imageId, options)
    } else if (node.rotation === 180) {
      backend.translate(node.x + node.width, node.y + node.height)
      backend.rotate(180)
      backend.drawImage(0, 0, node.width, node.height, node.imageId, options)
    } else {
      backend.translate(node.x, node.y + node.height)
      backend.rotate(270)
      backend.drawImage(0, 0, node.height, node.width, node.imageId, options)
    }
    backend.restore()
    return
  }
  backend.drawImage(node.x, node.y, node.width, node.height, node.imageId, options)
}

function isGradientPaintValue(paint: PaintValue | undefined): boolean {
  return paint !== undefined && typeof paint !== 'string'
}

function solidPaint(paint: PaintValue | undefined): string | undefined {
  return typeof paint === 'string' ? paint : undefined
}

function renderSvgNode(node: RenderSvg, backend: RenderBackend): void {
  if (backend.drawSvg) {
    backend.drawSvg(node.x, node.y, node.width, node.height, node.svgData)
  }
}

/** Notify the backend of a link annotation */
function emitLinkAnnotation(
  backend: RenderBackend,
  link: RenderLink,
  x: number, y: number, width: number, height: number,
  pageIndex: number, _pageHeight: number,
): void {
  const annotation: LinkAnnotation = {
    type: link.type,
    target: link.target,
    remoteDocument: link.remoteDocument,
    x, y, width, height,
  }
  backend.addAnnotation!(pageIndex, annotation)
}
