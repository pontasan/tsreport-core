/**
 * Type definitions for the internal SVG representation
 *
 * Parsed SVG XML is converted into this tree structure, which
 * svg-renderer.ts then translates into RenderBackend primitives for drawing.
 */

// ─── Transformation matrix (2D affine) ───

/** 2D affine transformation matrix [a, b, c, d, e, f] = | a c e | / | b d f | / | 0 0 1 | */
export type SvgMatrix = [number, number, number, number, number, number]

// ─── Color and style ───

export interface SvgColor {
  r: number // 0-255
  g: number // 0-255
  b: number // 0-255
  a?: number // 0-1
}

export interface SvgPaint {
  type: 'none' | 'color' | 'url' | 'currentColor'
  color?: SvgColor
  opacity?: number // 0-1
  url?: string     // gradient/pattern ID
  fallbackCurrentColor?: boolean
  paletteIndex?: number
}

export interface SvgStyle {
  color?: SvgColor
  fill?: SvgPaint
  stroke?: SvgPaint
  fillOpacity?: number
  strokeOpacity?: number
  strokeWidth?: number
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeMiterLimit?: number
  strokeDasharray?: number[]
  strokeDashoffset?: number
  vectorEffect?: 'none' | 'non-scaling-stroke'
  opacity?: number // element opacity
  fillRule?: 'nonzero' | 'evenodd'
  clipRule?: 'nonzero' | 'evenodd'
  markerStart?: string
  markerMid?: string
  markerEnd?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  fontStyle?: string
  textAnchor?: 'start' | 'middle' | 'end'
  letterSpacing?: number
  display?: string
  visibility?: string
  enableBackground?: string
  overflow?: string
}

// ─── Gradients ───

export interface SvgGradientStop {
  offset: number   // 0-1
  color: SvgColor
  opacity: number   // 0-1
  paletteIndex?: number
}

export interface SvgLinearGradient {
  type: 'linearGradient'
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  stops: SvgGradientStop[]
  gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  gradientTransform?: SvgMatrix
  spreadMethod: 'pad' | 'reflect' | 'repeat'
  href?: string // xlink:href for inheritance
}

export interface SvgRadialGradient {
  type: 'radialGradient'
  id: string
  cx: number
  cy: number
  r: number
  fx: number
  fy: number
  stops: SvgGradientStop[]
  gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  gradientTransform?: SvgMatrix
  spreadMethod: 'pad' | 'reflect' | 'repeat'
  href?: string
}

export type SvgGradient = SvgLinearGradient | SvgRadialGradient

// ─── Clip paths ───

export interface SvgClipPath {
  id: string
  children: SvgNode[]
  clipPathUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  clipRule?: 'nonzero' | 'evenodd'
}

export interface SvgPattern {
  id: string
  children: SvgNode[]
  x: number
  y: number
  width: number
  height: number
  patternUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  patternContentUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  patternTransform?: SvgMatrix
  viewBox?: { x: number, y: number, width: number, height: number }
  preserveAspectRatio?: string
  href?: string
}

export interface SvgMask {
  id: string
  children: SvgNode[]
  x: number
  y: number
  width: number
  height: number
  maskUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  maskContentUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  maskType: 'luminance' | 'alpha'
}

export interface SvgMarker {
  id: string
  children: SvgNode[]
  markerWidth: number
  markerHeight: number
  refX: number
  refY: number
  orient: 'auto' | 'auto-start-reverse' | number
  markerUnits: 'strokeWidth' | 'userSpaceOnUse'
  viewBox?: { x: number, y: number, width: number, height: number }
  preserveAspectRatio?: string
  overflow: 'hidden' | 'visible'
}

export interface SvgDropShadowFilter {
  type: 'drop-shadow'
  id: string
  filterUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  primitiveUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  x: number
  y: number
  width: number
  height: number
  includeSourceGraphic: boolean
  dx: number
  dy: number
  stdDeviation: number
  stdDeviationX?: number
  stdDeviationY?: number
  opacity: number
  color?: SvgColor
  blendMode: 'normal' | 'multiply' | 'screen' | 'darken' | 'lighten'
}

export interface SvgFilterPrimitive {
  type: string
  attributes: Record<string, string>
  children: SvgFilterPrimitive[]
}

export interface SvgFilterGraph {
  type: 'graph'
  id: string
  filterUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  primitiveUnits: 'userSpaceOnUse' | 'objectBoundingBox'
  x: number
  y: number
  width: number
  height: number
  attributes: Record<string, string>
  primitives: SvgFilterPrimitive[]
}

export type SvgFilter = SvgDropShadowFilter | SvgFilterGraph

// ─── SVG nodes ───

export interface SvgNodeBase {
  /** Element id attribute (OT-SVG glyph selection uses id="glyph{gid}") */
  id?: string
  style: SvgStyle
  transform?: SvgMatrix
  clipPathId?: string
  maskId?: string
  filterId?: string
  viewportClip?: { x: number, y: number, width: number, height: number }
}

export interface SvgGroup extends SvgNodeBase {
  type: 'g'
  children: SvgNode[]
}

export interface SvgPath extends SvgNodeBase {
  type: 'path'
  d?: string
  /** Path commands: 0=MoveTo, 1=LineTo, 2=CubicTo, 3=Close */
  commands: Uint8Array
  coords: Float32Array
}

export interface SvgRect extends SvgNodeBase {
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
  rx: number
  ry: number
}

export interface SvgCircle extends SvgNodeBase {
  type: 'circle'
  cx: number
  cy: number
  r: number
}

export interface SvgEllipse extends SvgNodeBase {
  type: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface SvgLine extends SvgNodeBase {
  type: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface SvgPolyline extends SvgNodeBase {
  type: 'polyline'
  points: Float32Array
}

export interface SvgPolygon extends SvgNodeBase {
  type: 'polygon'
  points: Float32Array
}

export interface SvgText extends SvgNodeBase {
  type: 'text'
  x: number
  y: number
  content: string
}

export interface SvgImage extends SvgNodeBase {
  type: 'image'
  x: number
  y: number
  width: number
  height: number
  href: string
  preserveAspectRatio?: string
}

export type SvgNode =
  | SvgGroup
  | SvgPath
  | SvgRect
  | SvgCircle
  | SvgEllipse
  | SvgLine
  | SvgPolyline
  | SvgPolygon
  | SvgText
  | SvgImage

// ─── SVG document ───

export interface SvgDocument {
  rootId?: string
  width: number
  height: number
  hasExplicitWidth: boolean
  hasExplicitHeight: boolean
  widthPercentage?: number
  heightPercentage?: number
  viewBox: { x: number, y: number, width: number, height: number }
  /** Whether the root <svg> element carried an explicit viewBox attribute */
  hasExplicitViewBox: boolean
  preserveAspectRatio: string
  rootStyle: SvgStyle
  children: SvgNode[]
  defs: SvgDefs
}

export interface SvgDefs {
  gradients: Map<string, SvgGradient>
  clipPaths: Map<string, SvgClipPath>
  patterns: Map<string, SvgPattern>
  masks: Map<string, SvgMask>
  markers: Map<string, SvgMarker>
  filters: Map<string, SvgFilter>
  /** Parsed graphical elements addressable through fragment references. */
  references: Map<string, SvgNode>
}
