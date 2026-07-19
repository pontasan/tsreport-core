/**
 * Flow Layout — automatic page-break + block-splitting utility
 *
 * Takes a sequence of content blocks and produces a RenderDocument by
 * inserting automatic page breaks and splitting blocks at page boundaries.
 *
 * Split strategy (industry standard: equivalent to common report behavior):
 * - text/line/image/rect/ellipse/path → atomic: move the whole element to the next page
 * - group → recursive split: apply the same logic to children
 * - Force clip-splitting only when an atomic element exceeds the page height
 */
import type {
  RenderDocument, RenderPage, RenderNode,
  RenderGroup, RenderText, RenderLine,
  RenderRect, RenderEllipse, RenderPath, RenderImage,
  RenderSvg,
} from '../types/render.js'

// ─── Public types ───

export interface FlowBlock {
  /** Block height (pt) */
  height: number
  /** Render nodes (coordinates relative to the block's top-left corner) */
  children: RenderNode[]
  /** true: do not split; move to the next page */
  keepTogether?: boolean
}

export interface FlowPageSettings {
  width: number
  height: number
  marginTop?: number
  marginBottom?: number
  marginLeft?: number
  marginRight?: number
}

export type FlowPageDecorator = (info: FlowPageInfo) => RenderNode[]

export interface FlowPageInfo {
  pageIndex: number
  totalPages: number
  contentWidth: number
  contentHeight: number
}

// ─── Bounding boxes ───

interface Bounds {
  top: number
  bottom: number
}

function getNodeBounds(node: RenderNode): Bounds {
  switch (node.type) {
    case 'text': {
      const t = node as RenderText
      return { top: t.y, bottom: t.y + t.fontSize }
    }
    case 'line': {
      const l = node as RenderLine
      const half = l.lineWidth * 0.5
      const minY = (l.y1 < l.y2 ? l.y1 : l.y2) - half
      const maxY = (l.y1 > l.y2 ? l.y1 : l.y2) + half
      return { top: minY, bottom: maxY }
    }
    case 'rect': {
      const r = node as RenderRect
      const rh = r.strokeWidth ? r.strokeWidth * 0.5 : 0
      return { top: r.y - rh, bottom: r.y + r.height + rh }
    }
    case 'ellipse': {
      const e = node as RenderEllipse
      const eh = e.strokeWidth ? e.strokeWidth * 0.5 : 0
      return { top: e.cy - e.ry - eh, bottom: e.cy + e.ry + eh }
    }
    case 'path': {
      const p = node as RenderPath
      const coords = p.coords
      const cmds = p.commands
      let minY = Infinity
      let maxY = -Infinity
      let ci = 0
      for (let i = 0; i < cmds.length; i++) {
        const cmd = cmds[i]
        if (cmd === 0 || cmd === 1) { // MoveTo, LineTo
          const py = pathPointY(p, ci)
          if (py < minY) minY = py
          if (py > maxY) maxY = py
          ci += 2
        } else if (cmd === 2) { // CubicTo
          for (let j = 0; j < 3; j++) {
            const py = pathPointY(p, ci + j * 2)
            if (py < minY) minY = py
            if (py > maxY) maxY = py
          }
          ci += 6
        }
        // cmd === 3 (Close) or unknown: no coords consumed
      }
      if (minY === Infinity) return { top: 0, bottom: 0 }
      // Account for strokeWidth
      const half = p.strokeWidth ? p.strokeWidth * 0.5 * pathTransformMaxScale(p) : 0
      return { top: minY - half, bottom: maxY + half }
    }
    case 'image': {
      const img = node as RenderImage
      return { top: img.y, bottom: img.y + img.height }
    }
    case 'svg': {
      const s = node as RenderSvg
      return { top: s.y, bottom: s.y + s.height }
    }
    case 'formField':
      return { top: node.y, bottom: node.y + node.height }
    case 'group': {
      const g = node as RenderGroup
      return { top: g.y, bottom: g.y + g.height }
    }
  }
}

// ─── Node Y offsetting ───

function offsetNodeY(node: RenderNode, dy: number): RenderNode {
  if (dy === 0) return node
  switch (node.type) {
    case 'text': {
      const t = node as RenderText
      const out: RenderText = {
        type: 'text', x: t.x, y: t.y + dy,
        text: t.text, fontId: t.fontId, fontSize: t.fontSize, color: t.color,
      }
      if (t.bold) out.bold = t.bold
      if (t.italic) out.italic = t.italic
      if (t.underline) out.underline = t.underline
      if (t.strikethrough) out.strikethrough = t.strikethrough
      if (t.hAlign) out.hAlign = t.hAlign
      if (t.width !== undefined) out.width = t.width
      if (t.letterSpacing !== undefined) out.letterSpacing = t.letterSpacing
      if (t.horizontalScale !== undefined) out.horizontalScale = t.horizontalScale
      if (t.baselineOffset !== undefined) out.baselineOffset = t.baselineOffset
      if (t.variation) out.variation = t.variation
      if (t.writingMode) out.writingMode = t.writingMode
      if (t.blendMode !== undefined) out.blendMode = t.blendMode
      if (t.overprintFill !== undefined) out.overprintFill = t.overprintFill
      if (t.overprintStroke !== undefined) out.overprintStroke = t.overprintStroke
      if (t.overprintMode !== undefined) out.overprintMode = t.overprintMode
      return out
    }
    case 'line': {
      const l = node as RenderLine
      const out: RenderLine = {
        type: 'line',
        x1: l.x1, y1: l.y1 + dy, x2: l.x2, y2: l.y2 + dy,
        lineWidth: l.lineWidth, color: l.color,
      }
      if (l.dash) out.dash = l.dash
      if (l.blendMode !== undefined) out.blendMode = l.blendMode
      if (l.overprintFill !== undefined) out.overprintFill = l.overprintFill
      if (l.overprintStroke !== undefined) out.overprintStroke = l.overprintStroke
      if (l.overprintMode !== undefined) out.overprintMode = l.overprintMode
      return out
    }
    case 'rect': {
      const r = node as RenderRect
      const out: RenderRect = {
        type: 'rect', x: r.x, y: r.y + dy, width: r.width, height: r.height,
      }
      if (r.radius !== undefined) out.radius = r.radius
      if (r.cornerRadii !== undefined) out.cornerRadii = { ...r.cornerRadii }
      if (r.fill) out.fill = r.fill
      if (r.stroke) out.stroke = r.stroke
      if (r.strokeWidth !== undefined) out.strokeWidth = r.strokeWidth
      if (r.blendMode !== undefined) out.blendMode = r.blendMode
      if (r.overprintFill !== undefined) out.overprintFill = r.overprintFill
      if (r.overprintStroke !== undefined) out.overprintStroke = r.overprintStroke
      if (r.overprintMode !== undefined) out.overprintMode = r.overprintMode
      return out
    }
    case 'ellipse': {
      const e = node as RenderEllipse
      const out: RenderEllipse = {
        type: 'ellipse', cx: e.cx, cy: e.cy + dy, rx: e.rx, ry: e.ry,
      }
      if (e.fill) out.fill = e.fill
      if (e.stroke) out.stroke = e.stroke
      if (e.strokeWidth !== undefined) out.strokeWidth = e.strokeWidth
      if (e.blendMode !== undefined) out.blendMode = e.blendMode
      if (e.overprintFill !== undefined) out.overprintFill = e.overprintFill
      if (e.overprintStroke !== undefined) out.overprintStroke = e.overprintStroke
      if (e.overprintMode !== undefined) out.overprintMode = e.overprintMode
      return out
    }
    case 'path': {
      const p = node as RenderPath
      const coords = p.coords
      const cmds = p.commands
      const newCoords = new Float32Array(coords.length)
      const affineTransform = p.affineTransform === undefined
        ? undefined
        : [...p.affineTransform] as [number, number, number, number, number, number]
      if (affineTransform !== undefined) affineTransform[5] += dy
      let ci = 0
      for (let i = 0; i < cmds.length; i++) {
        const cmd = cmds[i]
        if (cmd === 0 || cmd === 1) { // MoveTo, LineTo
          newCoords[ci] = coords[ci]!
          newCoords[ci + 1] = coords[ci + 1]! + (affineTransform === undefined ? dy : 0)
          ci += 2
        } else if (cmd === 2) { // CubicTo
          newCoords[ci] = coords[ci]!
          newCoords[ci + 1] = coords[ci + 1]! + (affineTransform === undefined ? dy : 0)
          newCoords[ci + 2] = coords[ci + 2]!
          newCoords[ci + 3] = coords[ci + 3]! + (affineTransform === undefined ? dy : 0)
          newCoords[ci + 4] = coords[ci + 4]!
          newCoords[ci + 5] = coords[ci + 5]! + (affineTransform === undefined ? dy : 0)
          ci += 6
        }
        // cmd === 3 (Close): no coords
      }
      const out: RenderPath = { type: 'path', commands: cmds, coords: newCoords, affineTransform }
      if (p.fill) out.fill = p.fill
      if (p.stroke) out.stroke = p.stroke
      if (p.strokeWidth !== undefined) out.strokeWidth = p.strokeWidth
      if (p.blendMode !== undefined) out.blendMode = p.blendMode
      if (p.overprintFill !== undefined) out.overprintFill = p.overprintFill
      if (p.overprintStroke !== undefined) out.overprintStroke = p.overprintStroke
      if (p.overprintMode !== undefined) out.overprintMode = p.overprintMode
      return out
    }
    case 'image': {
      const img = node as RenderImage
      const out: RenderImage = {
        type: 'image', x: img.x, y: img.y + dy,
        width: img.width, height: img.height, imageId: img.imageId,
      }
      if (img.rotation !== undefined) out.rotation = img.rotation
      if (img.opacity !== undefined) out.opacity = img.opacity
      if (img.affineTransform !== undefined) {
        out.affineTransform = img.affineTransform.slice() as [number, number, number, number, number, number]
        out.affineTransform[5] += dy
      }
      if (img.blendMode !== undefined) out.blendMode = img.blendMode
      if (img.overprintFill !== undefined) out.overprintFill = img.overprintFill
      if (img.overprintStroke !== undefined) out.overprintStroke = img.overprintStroke
      if (img.overprintMode !== undefined) out.overprintMode = img.overprintMode
      if (img.link !== undefined) out.link = img.link
      if (img.tag !== undefined) out.tag = img.tag
      return out
    }
    case 'formField':
      return { ...node, y: node.y + dy }
    case 'svg': {
      const s = node as RenderSvg
      const out: RenderSvg = {
        type: 'svg',
        x: s.x,
        y: s.y + dy,
        width: s.width,
        height: s.height,
        svgData: s.svgData,
      }
      if (s.blendMode !== undefined) out.blendMode = s.blendMode
      if (s.overprintFill !== undefined) out.overprintFill = s.overprintFill
      if (s.overprintStroke !== undefined) out.overprintStroke = s.overprintStroke
      if (s.overprintMode !== undefined) out.overprintMode = s.overprintMode
      return out
    }
    case 'group': {
      const g = node as RenderGroup
      const out: RenderGroup = {
        type: 'group', x: g.x, y: g.y + dy,
        width: g.width, height: g.height, children: g.children,
      }
      if (g.clip) out.clip = g.clip
      if (g.opacity !== undefined) out.opacity = g.opacity
      if (g.rotation !== undefined) out.rotation = g.rotation
      if (g.rotationOriginX !== undefined) out.rotationOriginX = g.rotationOriginX
      if (g.rotationOriginY !== undefined) out.rotationOriginY = g.rotationOriginY
      if (g.blendMode !== undefined) out.blendMode = g.blendMode
      if (g.overprintFill !== undefined) out.overprintFill = g.overprintFill
      if (g.overprintStroke !== undefined) out.overprintStroke = g.overprintStroke
      if (g.overprintMode !== undefined) out.overprintMode = g.overprintMode
      if (g.link) out.link = g.link
      if (g.tag) out.tag = g.tag
      if (g.optionalContent) out.optionalContent = g.optionalContent
      return out
    }
  }
}

function pathPointY(path: RenderPath, index: number): number {
  const matrix = path.affineTransform
  if (matrix === undefined) return path.coords[index + 1]!
  return matrix[1] * path.coords[index]! + matrix[3] * path.coords[index + 1]! + matrix[5]
}

function pathTransformMaxScale(path: RenderPath): number {
  const matrix = path.affineTransform
  if (matrix === undefined) return 1
  const a = matrix[0], b = matrix[1], c = matrix[2], d = matrix[3]
  const trace = a * a + b * b + c * c + d * d
  const determinant = a * d - b * c
  return Math.sqrt((trace + Math.sqrt(Math.max(0, trace * trace - 4 * determinant * determinant))) / 2)
}

// ─── Split result ───

interface SplitResult {
  /** Elements kept on the current page */
  current: RenderNode[]
  /** Elements moved to the next page (Y already offset to start at 0) */
  next: RenderNode[]
}

// ─── Block splitting ───

function adjustNegativeY(nodes: RenderNode[]): RenderNode[] {
  // If boundary-crossing elements have negative Y from -splitY, shift all elements so min Y = 0
  let minY = 0
  for (let i = 0; i < nodes.length; i++) {
    const b = getNodeBounds(nodes[i]!)
    if (b.top < minY) minY = b.top
  }
  if (minY >= 0) return nodes
  const shift = -minY
  const out: RenderNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    out.push(offsetNodeY(nodes[i]!, shift))
  }
  return out
}

function splitChildren(
  children: RenderNode[],
  splitY: number,
  contentHeight: number,
  contentWidth: number,
): SplitResult {
  const current: RenderNode[] = []
  const next: RenderNode[] = []

  for (let i = 0; i < children.length; i++) {
    const node = children[i]!
    const bounds = getNodeBounds(node)

    if (bounds.bottom <= splitY) {
      // Entirely within the current page
      current.push(node)
    } else if (bounds.top >= splitY) {
      // Entirely on the next page (uniform offset by -splitY)
      next.push(offsetNodeY(node, -splitY))
    } else {
      // Crosses the boundary
      if (node.type === 'group') {
        const g = node as RenderGroup
        const localSplitY = splitY - g.y
        if (localSplitY <= 0) {
          // The whole group is at or below splitY: move it entirely to the next page
          next.push(offsetNodeY(node, -splitY))
          continue
        }
        const sub = splitChildren(g.children, localSplitY, contentHeight, contentWidth)
        if (sub.current.length > 0) {
          const gc: RenderGroup = {
            type: 'group', x: g.x, y: g.y,
            width: g.width, height: localSplitY,
            children: sub.current,
          }
          if (g.clip) gc.clip = g.clip
          if (g.opacity !== undefined) gc.opacity = g.opacity
          if (g.rotation !== undefined) gc.rotation = g.rotation
          if (g.rotationOriginX !== undefined) gc.rotationOriginX = g.rotationOriginX
          if (g.rotationOriginY !== undefined) gc.rotationOriginY = g.rotationOriginY
          current.push(gc)
        }
        if (sub.next.length > 0) {
          // Correct negative Y values and recompute the height
          const adjusted = adjustNegativeY(sub.next)
          let maxBottom = 0
          for (let j = 0; j < adjusted.length; j++) {
            const b = getNodeBounds(adjusted[j]!)
            if (b.bottom > maxBottom) maxBottom = b.bottom
          }
          // y is g.y - splitY to stay consistent with the siblings' -splitY offset
          // (negative values are corrected by the parent's adjustNegativeY)
          const gn: RenderGroup = {
            type: 'group', x: g.x, y: g.y - splitY,
            width: g.width, height: maxBottom,
            children: adjusted,
          }
          if (g.clip) gn.clip = g.clip
          if (g.opacity !== undefined) gn.opacity = g.opacity
          if (g.rotation !== undefined) gn.rotation = g.rotation
          if (g.rotationOriginX !== undefined) gn.rotationOriginX = g.rotationOriginX
          if (g.rotationOriginY !== undefined) gn.rotationOriginY = g.rotationOriginY
          next.push(gn)
        }
      } else {
        // Atomic element
        const elemHeight = bounds.bottom - bounds.top
        // rect/line are decorative elements, so clip-split them (cut cleanly at the page boundary)
        // text/image etc. move entirely to the next page (cutting them mid-way looks bad)
        // However, when an element exceeds the page height, force clip-splitting for all types
        if (node.type === 'rect' || node.type === 'line' || elemHeight > contentHeight) {
          const clipHeight = splitY - bounds.top
          current.push({
            type: 'group',
            x: 0, y: bounds.top,
            width: contentWidth,
            height: clipHeight,
            clip: true,
            children: [offsetNodeY(node, -bounds.top)],
          } as RenderGroup)
          next.push({
            type: 'group',
            x: 0, y: 0,
            width: contentWidth,
            height: elemHeight - clipHeight,
            clip: true,
            children: [offsetNodeY(node, -bounds.top - clipHeight)],
          } as RenderGroup)
        } else {
          // Move entirely to the next page (uniform -splitY offset preserves relative position to siblings)
          next.push(offsetNodeY(node, -splitY))
        }
      }
    }
  }

  return { current, next }
}

// ─── Main function ───

export function flowLayout(
  blocks: FlowBlock[],
  settings: FlowPageSettings,
  decorator?: FlowPageDecorator,
): RenderDocument {
  const mt = settings.marginTop ?? 0
  const mb = settings.marginBottom ?? 0
  const ml = settings.marginLeft ?? 0
  const mr = settings.marginRight ?? 0
  const contentWidth = settings.width - ml - mr
  const contentHeight = settings.height - mt - mb

  // Page data: accumulates a RenderNode[] for each page
  const pageNodes: RenderNode[][] = []
  let currentPageNodes: RenderNode[] = []
  let cursorY = 0

  function newPage(): void {
    pageNodes.push(currentPageNodes)
    currentPageNodes = []
    cursorY = 0
  }

  function placeBlock(children: RenderNode[], blockHeight: number): void {
    // Place children with their Y coordinates offset by cursorY
    for (let i = 0; i < children.length; i++) {
          currentPageNodes.push(offsetNodeY(children[i]!, cursorY))
    }
    cursorY += blockHeight
  }

  // Common loop for split placement
  function splitAndPlace(children: RenderNode[], height: number): void {
    let pendingChildren = children
    let pendingHeight = height
    // Infinite loop guard: page count cap (max 1000 pages per element)
    let maxIter = 1000

    while (pendingChildren.length > 0) {
      if (--maxIter < 0) break
      const availHeight = contentHeight - cursorY
      if (pendingHeight <= availHeight) {
        placeBlock(pendingChildren, pendingHeight)
        break
      }
      // Split
      const split = splitChildren(pendingChildren, availHeight, contentHeight, contentWidth)
      if (split.current.length > 0) {
        for (let i = 0; i < split.current.length; i++) {
          currentPageNodes.push(offsetNodeY(split.current[i]!, cursorY))
        }
      }
      // Empty split.next = all elements fit into current
      if (split.next.length === 0) break
      newPage()
      // Atomic elements that crossed the boundary may have negative Y from -splitY
      // Shift so that the minimum Y aligns to 0, preserving relative position to siblings
      let minY = 0
      for (let i = 0; i < split.next.length; i++) {
        const b = getNodeBounds(split.next[i]!)
        if (b.top < minY) minY = b.top
      }
      if (minY < 0) {
        const shift = -minY
        pendingChildren = []
        for (let i = 0; i < split.next.length; i++) {
          pendingChildren.push(offsetNodeY(split.next[i]!, shift))
        }
      } else {
        pendingChildren = split.next
      }
      // Recompute the remaining height for the next page (bounds-based)
      let nextMaxBottom = 0
      for (let i = 0; i < pendingChildren.length; i++) {
        const b = getNodeBounds(pendingChildren[i]!)
        if (b.bottom > nextMaxBottom) nextMaxBottom = b.bottom
      }
      pendingHeight = nextMaxBottom
    }
  }

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi]!
    if (block.children.length === 0) continue

    const remaining = contentHeight - cursorY

    if (block.height <= remaining) {
      // The whole block fits
      placeBlock(block.children, block.height)
    } else if (block.keepTogether && block.height <= contentHeight) {
      // keepTogether and fits on the next page: place at the top of the next page
      newPage()
      placeBlock(block.children, block.height)
    } else {
      // Split placement (even with keepTogether, split when exceeding contentHeight)
      splitAndPlace(block.children, block.height)
    }
  }

  // Finalize the last page
  if (currentPageNodes.length > 0 || pageNodes.length === 0) {
    pageNodes.push(currentPageNodes)
  }

  // Build pages
  const totalPages = pageNodes.length
  const pages: RenderPage[] = []
  for (let pi = 0; pi < totalPages; pi++) {
    const children: RenderNode[] = []
    // Place content in a group offset by the margins
    const contentGroup: RenderGroup = {
      type: 'group',
      x: ml, y: mt,
      width: contentWidth, height: contentHeight,
      children: pageNodes[pi]!,
    }
    children.push(contentGroup)

    // Add page decorations via the decorator
    if (decorator) {
      const decoNodes = decorator({
        pageIndex: pi,
        totalPages,
        contentWidth,
        contentHeight,
      })
      for (let di = 0; di < decoNodes.length; di++) {
        children.push(decoNodes[di]!)
      }
    }

    pages.push({
      width: settings.width,
      height: settings.height,
      children,
    })
  }

  return { pages }
}
