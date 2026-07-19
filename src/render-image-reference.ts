import type { PaintValue, TileGraphic } from './renderer/backend.js'
import type { RenderDocument, RenderNode } from './types/render.js'

export interface RenderImageReference {
  imageId: string
}

export type RenderImageReferenceVisitor<T> = (reference: RenderImageReference, context: T) => void

export function forEachRenderDocumentImageReference<T>(
  document: RenderDocument,
  visitor: RenderImageReferenceVisitor<T>,
  context: T,
): void {
  for (let pageIndex = 0; pageIndex < document.pages.length; pageIndex++) {
    visitRenderNodes(document.pages[pageIndex]!.children, visitor, context)
  }
}

function visitRenderNodes<T>(
  nodes: RenderNode[],
  visitor: RenderImageReferenceVisitor<T>,
  context: T,
): void {
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const node = nodes[nodeIndex]!
    switch (node.type) {
      case 'group':
        visitRenderNodes(node.children, visitor, context)
        if (node.softMask !== undefined) {
          visitRenderNodes(node.softMask.content, visitor, context)
        }
        break
      case 'rect':
      case 'ellipse':
        visitPaint(node.fill, visitor, context)
        break
      case 'path':
        visitPaint(node.fill, visitor, context)
        visitPaint(node.stroke, visitor, context)
        break
      case 'image':
        visitor(node, context)
        if (node.alternates !== undefined) {
          for (let alternateIndex = 0; alternateIndex < node.alternates.length; alternateIndex++) {
            visitor(node.alternates[alternateIndex]!, context)
          }
        }
        break
      case 'text':
      case 'line':
      case 'svg':
      case 'formField':
        break
      default:
        node satisfies never
    }
  }
}

function visitPaint<T>(
  paint: PaintValue | undefined,
  visitor: RenderImageReferenceVisitor<T>,
  context: T,
): void {
  if (typeof paint !== 'object') return
  switch (paint.type) {
    case 'tiling-pattern':
      visitTileGraphics(paint.graphics, visitor, context)
      break
    case 'pdfSpecialColor':
    case 'linear-gradient':
    case 'radial-gradient':
    case 'mesh-gradient':
    case 'function-shading':
      break
    default:
      paint satisfies never
  }
}

function visitTileGraphics<T>(
  graphics: TileGraphic[],
  visitor: RenderImageReferenceVisitor<T>,
  context: T,
): void {
  for (let graphicIndex = 0; graphicIndex < graphics.length; graphicIndex++) {
    const graphic = graphics[graphicIndex]!
    switch (graphic.kind) {
      case 'image':
        visitor(graphic, context)
        break
      case 'path':
        visitPaint(graphic.fill, visitor, context)
        visitPaint(graphic.stroke, visitor, context)
        break
      case 'group':
        visitTileGraphics(graphic.graphics, visitor, context)
        if (graphic.softMask !== undefined) {
          visitTileGraphics(graphic.softMask.graphics, visitor, context)
        }
        break
      case 'text':
        break
      default:
        graphic satisfies never
    }
  }
}
