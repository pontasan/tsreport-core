// Shared geometry for the complex paint kinds (mesh gradients and tiling
// patterns). The Canvas and SVG backends have no native mesh primitive, so
// both render the SAME deterministic tessellation produced here — flat
// colored triangles fine enough that the shading looks continuous — which
// keeps the three backends WYSIWYG-identical. The PDF backend emits native
// shading streams instead and only uses the transform helpers.

import type { FunctionShadingPaint, MeshGradientPaint, MeshPatch, MeshTriangle, PaintValue, TilingPatternPaint } from './backend.js'
import { evaluateCalculatorSource } from '../pdf/pdf-function.js'

/**
 * Coons interior control points from the 12 boundary points of a 4x4
 * tensor grid (row-major p00..p33), per ISO 32000-1 8.7.4.5.7. Returns the
 * four interior points as [p11, p12, p21, p22], each [x, y].
 */
export function coonsInteriorPoints(grid: (readonly [number, number])[]): [number, number][] {
  const g = function (i: number, j: number): readonly [number, number] { return grid[i * 4 + j]! }
  const combine = function (terms: [number, readonly [number, number]][]): [number, number] {
    let x = 0
    let y = 0
    for (let t = 0; t < terms.length; t++) {
      x += terms[t]![0] * terms[t]![1][0]
      y += terms[t]![0] * terms[t]![1][1]
    }
    return [x / 9, y / 9]
  }
  return [
    combine([[-4, g(0, 0)], [6, g(0, 1)], [6, g(1, 0)], [-2, g(0, 3)], [-2, g(3, 0)], [3, g(1, 3)], [3, g(3, 1)], [-1, g(3, 3)]]),
    combine([[-4, g(0, 3)], [6, g(0, 2)], [6, g(1, 3)], [-2, g(0, 0)], [-2, g(3, 3)], [3, g(1, 0)], [3, g(3, 2)], [-1, g(3, 0)]]),
    combine([[-4, g(3, 0)], [6, g(3, 1)], [6, g(2, 0)], [-2, g(3, 3)], [-2, g(0, 0)], [3, g(2, 3)], [3, g(0, 1)], [-1, g(0, 3)]]),
    combine([[-4, g(3, 3)], [6, g(3, 2)], [6, g(2, 3)], [-2, g(3, 0)], [-2, g(0, 3)], [3, g(2, 0)], [3, g(0, 2)], [-1, g(0, 0)]]),
  ]
}

export function isComplexPaint(paint: PaintValue | undefined): paint is MeshGradientPaint | TilingPatternPaint | FunctionShadingPaint {
  return paint !== undefined && typeof paint !== 'string'
    && (paint.type === 'mesh-gradient' || paint.type === 'tiling-pattern' || paint.type === 'function-shading')
}

/**
 * Tessellates a function-based shading (ShadingType 1) for the display
 * backends: the domain is sampled at the requested /SM precision and each
 * cell becomes two triangles refined by the shared tessellation. Uses the
 * same function inputs the PDF output embeds, so the display matches the
 * native shading.
 */
export interface ShadingTessellationOptions {
  /** PDF /SM maximum per-component color error, in the range 0..1. */
  smoothness?: number
  /** Conservative visible bounds in the paint coordinate system. */
  bounds?: [number, number, number, number]
}

export function tessellateFunctionShading(
  paint: FunctionShadingPaint,
  options?: ShadingTessellationOptions,
): MeshFillTriangle[] {
  const grid = functionShadingGrid(options?.smoothness)
  const [x0, x1, y0, y1] = paint.domain
  const m = paint.matrix
  const vertices: { x: number, y: number, color: string }[] = []
  for (let j = 0; j <= grid; j++) {
    for (let i = 0; i <= grid; i++) {
      const dx = x0 + (x1 - x0) * i / grid
      const dy = y0 + (y1 - y0) * j / grid
      const rgb = 'sampled' in paint
        ? evaluateSampledFunctionPaint(paint, dx, dy)
        : evaluateCalculatorSource(paint.expression, [dx, dy], 3)
      vertices.push({
        x: m[0] * dx + m[2] * dy + m[4],
        y: m[1] * dx + m[3] * dy + m[5],
        color: rgbToHexColor(clampUnit(rgb[0]!) * 255, clampUnit(rgb[1]!) * 255, clampUnit(rgb[2]!) * 255),
      })
    }
  }
  const out: MeshFillTriangle[] = []
  const columns = grid + 1
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const v00 = vertices[j * columns + i]!
      const v01 = vertices[j * columns + i + 1]!
      const v10 = vertices[(j + 1) * columns + i]!
      const v11 = vertices[(j + 1) * columns + i + 1]!
      tessellateTriangle({
        points: [v00.x, v00.y, v01.x, v01.y, v10.x, v10.y],
        colors: [v00.color, v01.color, v10.color],
      }, out, options?.smoothness, options?.smoothness === undefined)
      tessellateTriangle({
        points: [v01.x, v01.y, v11.x, v11.y, v10.x, v10.y],
        colors: [v01.color, v11.color, v10.color],
      }, out, options?.smoothness, options?.smoothness === undefined)
    }
  }
  return out
}

function functionShadingGrid(smoothness: number | undefined): number {
  if (smoothness === undefined) return 16
  validateSmoothness(smoothness)
  // The display backends emit 8-bit RGB. Errors below one code value cannot
  // change their output, so /SM 0 uses the device's exact representable limit.
  return Math.ceil(1 / Math.max(smoothness, 1 / 255))
}

function evaluateSampledFunctionPaint(paint: FunctionShadingPaint, x: number, y: number): number[] {
  if (!('sampled' in paint)) throw new Error('Sampled function paint is required')
  const sampled = paint.sampled
  const sx = sampled.size[0]
  const sy = sampled.size[1]
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || sx <= 0 || sy <= 0) {
    throw new Error('Sampled function size values must be positive integers')
  }
  if (sampled.samples.length !== sx * sy * 3) {
    throw new Error('Sampled function samples length must match size and RGB output count')
  }
  const encode = sampled.encode ?? [0, sx - 1, 0, sy - 1]
  const px = sampledPosition(x, paint.domain[0], paint.domain[1], encode[0], encode[1], sx)
  const py = sampledPosition(y, paint.domain[2], paint.domain[3], encode[2], encode[3], sy)
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const x1 = Math.min(x0 + 1, sx - 1)
  const y1 = Math.min(y0 + 1, sy - 1)
  const tx = px - x0
  const ty = py - y0
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const v00 = sampledValue(sampled.samples, sx, x0, y0, c)
    const v10 = sampledValue(sampled.samples, sx, x1, y0, c)
    const v01 = sampledValue(sampled.samples, sx, x0, y1, c)
    const v11 = sampledValue(sampled.samples, sx, x1, y1, c)
    out[c] = v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
  }
  return out
}

function sampledPosition(input: number, d0: number, d1: number, e0: number, e1: number, size: number): number {
  const clamped = Math.max(Math.min(input, Math.max(d0, d1)), Math.min(d0, d1))
  const span = d1 - d0
  const encoded = span === 0 ? e0 : e0 + (clamped - d0) / span * (e1 - e0)
  return Math.max(0, Math.min(size - 1, encoded))
}

function sampledValue(samples: number[], sx: number, x: number, y: number, component: number): number {
  return samples[(y * sx + x) * 3 + component]!
}

function clampUnit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Flat-colored triangle produced by the tessellation (page coordinates). */
export interface MeshFillTriangle {
  /** x0,y0,x1,y1,x2,y2 */
  points: [number, number, number, number, number, number]
  color: string
}

export interface PackedMeshFillCell {
  points: [number, number, number, number, number, number, number, number]
  colors: [number, number, number, number]
}

/** Target edge length of a tessellation cell (pt) */
const CELL_SIZE_PT = 3
const MIN_SEGMENTS = 4
const MAX_SEGMENTS = 48
/** Inflation factor about the cell centroid that hides antialiasing seams */
const SEAM_INFLATE = 1.15
const PACKED_CELL_SIZE_PT = 8

// ─── Color helpers ───

/** Parses #RGB / #RRGGBB (mesh colors are always hex; the importer emits hex). */
export function parseHexColor(color: string): [number, number, number] {
  if (color.length === 4 && color[0] === '#') {
    const r = parseInt(color[1]! + color[1]!, 16)
    const g = parseInt(color[2]! + color[2]!, 16)
    const b = parseInt(color[3]! + color[3]!, 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b]
  }
  if (color.length === 7 && color[0] === '#') {
    const r = parseInt(color.substring(1, 3), 16)
    const g = parseInt(color.substring(3, 5), 16)
    const b = parseInt(color.substring(5, 7), 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b]
  }
  throw new Error(`Mesh gradient color must be #RGB or #RRGGBB: ${color}`)
}

function toHex2(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)))
  return (clamped < 16 ? '0' : '') + clamped.toString(16)
}

export function rgbToHexColor(r: number, g: number, b: number): string {
  return '#' + toHex2(r) + toHex2(g) + toHex2(b)
}

// ─── Mesh tessellation ───

function bezier1d(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

/** Evaluates the tensor-product surface point at (u, v). */
function patchPoint(points: number[], u: number, v: number): [number, number] {
  // Rows along v for each u index, then a bezier across u
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < 4; i++) {
    const base = i * 8
    xs.push(bezier1d(points[base]!, points[base + 2]!, points[base + 4]!, points[base + 6]!, v))
    ys.push(bezier1d(points[base + 1]!, points[base + 3]!, points[base + 5]!, points[base + 7]!, v))
  }
  return [bezier1d(xs[0]!, xs[1]!, xs[2]!, xs[3]!, u), bezier1d(ys[0]!, ys[1]!, ys[2]!, ys[3]!, u)]
}

/**
 * Streams compact imported-PDF tensor patches as gradient cells. Imported
 * meshes are already subdivided by the source PDF, so this avoids building
 * millions of intermediate flat triangles while retaining curved geometry.
 */
export function forEachPackedMeshCell(
  paint: MeshGradientPaint,
  callback: (cell: PackedMeshFillCell) => void,
  bounds?: [number, number, number, number],
): void {
  const packed = paint.packedPatches
  if (packed === undefined) return
  const patchCount = Math.floor(packed.points.length / 32)
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
    const offset = patchIndex * 32
    if (bounds !== undefined && !packedPointsIntersectBounds(packed.points, offset, 32, bounds)) continue
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = offset; i < offset + 32; i += 2) {
      minX = Math.min(minX, packed.points[i]!)
      minY = Math.min(minY, packed.points[i + 1]!)
      maxX = Math.max(maxX, packed.points[i]!)
      maxY = Math.max(maxY, packed.points[i + 1]!)
    }
    const segments = Math.max(1, Math.min(24, Math.ceil(Math.max(maxX - minX, maxY - minY) / PACKED_CELL_SIZE_PT)))
    const grid: [number, number][][] = []
    for (let uIndex = 0; uIndex <= segments; uIndex++) {
      const row: [number, number][] = []
      for (let vIndex = 0; vIndex <= segments; vIndex++) {
        row.push(packedPatchPoint(packed.points, offset, uIndex / segments, vIndex / segments))
      }
      grid.push(row)
    }
    const colorOffset = patchIndex * 4
    for (let uIndex = 0; uIndex < segments; uIndex++) {
      const u0 = uIndex / segments
      const u1 = (uIndex + 1) / segments
      for (let vIndex = 0; vIndex < segments; vIndex++) {
        const v0 = vIndex / segments
        const v1 = (vIndex + 1) / segments
        const p00 = grid[uIndex]![vIndex]!
        const p01 = grid[uIndex]![vIndex + 1]!
        const p11 = grid[uIndex + 1]![vIndex + 1]!
        const p10 = grid[uIndex + 1]![vIndex]!
        callback({
          points: [p00[0], p00[1], p01[0], p01[1], p11[0], p11[1], p10[0], p10[1]],
          colors: [
            packedPatchColor(packed.colors, colorOffset, u0, v0),
            packedPatchColor(packed.colors, colorOffset, u0, v1),
            packedPatchColor(packed.colors, colorOffset, u1, v1),
            packedPatchColor(packed.colors, colorOffset, u1, v0),
          ],
        })
      }
    }
  }
}

function packedPatchPoint(points: Float32Array, offset: number, u: number, v: number): [number, number] {
  const xs = [0, 0, 0, 0]
  const ys = [0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    const base = offset + i * 8
    xs[i] = bezier1d(points[base]!, points[base + 2]!, points[base + 4]!, points[base + 6]!, v)
    ys[i] = bezier1d(points[base + 1]!, points[base + 3]!, points[base + 5]!, points[base + 7]!, v)
  }
  return [bezier1d(xs[0]!, xs[1]!, xs[2]!, xs[3]!, u), bezier1d(ys[0]!, ys[1]!, ys[2]!, ys[3]!, u)]
}

function packedPatchColor(colors: Uint32Array, offset: number, u: number, v: number): number {
  const c00 = colors[offset]!
  const c01 = colors[offset + 1]!
  const c11 = colors[offset + 2]!
  const c10 = colors[offset + 3]!
  const w00 = (1 - u) * (1 - v)
  const w01 = (1 - u) * v
  const w11 = u * v
  const w10 = u * (1 - v)
  const component = function (shift: number): number {
    return Math.round(((c00 >> shift) & 0xff) * w00 + ((c01 >> shift) & 0xff) * w01
      + ((c11 >> shift) & 0xff) * w11 + ((c10 >> shift) & 0xff) * w10)
  }
  return (component(16) << 16) | (component(8) << 8) | component(0)
}

function patchColor(colors: [string, string, string, string], u: number, v: number): string {
  const c00 = parseHexColor(colors[0])
  const c01 = parseHexColor(colors[1])
  const c11 = parseHexColor(colors[2])
  const c10 = parseHexColor(colors[3])
  const w00 = (1 - u) * (1 - v)
  const w01 = (1 - u) * v
  const w11 = u * v
  const w10 = u * (1 - v)
  return rgbToHexColor(
    c00[0] * w00 + c01[0] * w01 + c11[0] * w11 + c10[0] * w10,
    c00[1] * w00 + c01[1] * w01 + c11[1] * w11 + c10[1] * w10,
    c00[2] * w00 + c01[2] * w01 + c11[2] * w11 + c10[2] * w10,
  )
}

function inflateTriangle(points: [number, number, number, number, number, number]): [number, number, number, number, number, number] {
  const cx = (points[0] + points[2] + points[4]) / 3
  const cy = (points[1] + points[3] + points[5]) / 3
  const result: number[] = []
  for (let i = 0; i < 6; i += 2) {
    result.push(cx + (points[i]! - cx) * SEAM_INFLATE)
    result.push(cy + (points[i + 1]! - cy) * SEAM_INFLATE)
  }
  return result as [number, number, number, number, number, number]
}

function segmentsForExtent(extent: number): number {
  return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, Math.ceil(extent / CELL_SIZE_PT)))
}

function tessellatePatch(patch: MeshPatch, out: MeshFillTriangle[], smoothness: number | undefined): void {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < 32; i += 2) {
    minX = Math.min(minX, patch.points[i]!)
    maxX = Math.max(maxX, patch.points[i]!)
    minY = Math.min(minY, patch.points[i + 1]!)
    maxY = Math.max(maxY, patch.points[i + 1]!)
  }
  const n = Math.max(
    segmentsForExtent(Math.max(maxX - minX, maxY - minY)),
    segmentsForColors(patch.colors, smoothness),
  )
  // Precompute the (n+1)x(n+1) grid of surface points
  const grid: [number, number][][] = []
  for (let i = 0; i <= n; i++) {
    const row: [number, number][] = []
    for (let j = 0; j <= n; j++) {
      row.push(patchPoint(patch.points, i / n, j / n))
    }
    grid.push(row)
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p00 = grid[i]![j]!
      const p01 = grid[i]![j + 1]!
      const p11 = grid[i + 1]![j + 1]!
      const p10 = grid[i + 1]![j]!
      const color = patchColor(patch.colors, (i + 0.5) / n, (j + 0.5) / n)
      out.push({ points: inflateTriangle([p00[0], p00[1], p01[0], p01[1], p11[0], p11[1]]), color })
      out.push({ points: inflateTriangle([p00[0], p00[1], p11[0], p11[1], p10[0], p10[1]]), color })
    }
  }
}

function triangleColorAt(colors: [string, string, string], w0: number, w1: number, w2: number): string {
  const c0 = parseHexColor(colors[0])
  const c1 = parseHexColor(colors[1])
  const c2 = parseHexColor(colors[2])
  return rgbToHexColor(
    c0[0] * w0 + c1[0] * w1 + c2[0] * w2,
    c0[1] * w0 + c1[1] * w1 + c2[1] * w2,
    c0[2] * w0 + c1[2] * w1 + c2[2] * w2,
  )
}

function tessellateTriangle(
  triangle: MeshTriangle,
  out: MeshFillTriangle[],
  smoothness?: number,
  includeExtent = true,
): void {
  const [x0, y0, x1, y1, x2, y2] = triangle.points as [number, number, number, number, number, number]
  const extent = Math.max(
    Math.hypot(x1 - x0, y1 - y0),
    Math.hypot(x2 - x1, y2 - y1),
    Math.hypot(x0 - x2, y0 - y2),
  )
  const n = Math.max(includeExtent ? segmentsForExtent(extent) : 1, segmentsForColors(triangle.colors, smoothness))
  // Barycentric subdivision into n^2 sub-triangles
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - i; j++) {
      // Upright sub-triangle at barycentric lattice (i, j)
      const a = barycentricPoint(x0, y0, x1, y1, x2, y2, i / n, j / n)
      const b = barycentricPoint(x0, y0, x1, y1, x2, y2, (i + 1) / n, j / n)
      const c = barycentricPoint(x0, y0, x1, y1, x2, y2, i / n, (j + 1) / n)
      const w1c = (i + 1 / 3) / n
      const w2c = (j + 1 / 3) / n
      out.push({
        points: inflateTriangle([a[0], a[1], b[0], b[1], c[0], c[1]]),
        color: triangleColorAt(triangle.colors as [string, string, string], 1 - w1c - w2c, w1c, w2c),
      })
      if (j < n - i - 1) {
        // Inverted companion sub-triangle
        const d = barycentricPoint(x0, y0, x1, y1, x2, y2, (i + 1) / n, (j + 1) / n)
        const w1d = (i + 2 / 3) / n
        const w2d = (j + 2 / 3) / n
        out.push({
          points: inflateTriangle([b[0], b[1], d[0], d[1], c[0], c[1]]),
          color: triangleColorAt(triangle.colors as [string, string, string], 1 - w1d - w2d, w1d, w2d),
        })
      }
    }
  }
}

function segmentsForColors(colors: readonly string[], smoothness: number | undefined): number {
  if (smoothness === undefined) return 1
  validateSmoothness(smoothness)
  let maximumColorSpan = 0
  let minimum = 255
  let maximum = 0
  for (let component = 0; component < 3; component++) {
    minimum = 255
    maximum = 0
    for (let i = 0; i < colors.length; i++) {
      const value = parseHexColor(colors[i]!)[component]!
      if (value < minimum) minimum = value
      if (value > maximum) maximum = value
    }
    const span = (maximum - minimum) / 255
    if (span > maximumColorSpan) maximumColorSpan = span
  }
  return Math.max(1, Math.ceil(maximumColorSpan / Math.max(smoothness, 1 / 255)))
}

function validateSmoothness(smoothness: number): void {
  if (!Number.isFinite(smoothness) || smoothness < 0 || smoothness > 1) {
    throw new Error('PDF smoothness must be between 0 and 1')
  }
}

function barycentricPoint(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
  w1: number, w2: number,
): [number, number] {
  const w0 = 1 - w1 - w2
  return [x0 * w0 + x1 * w1 + x2 * w2, y0 * w0 + y1 * w1 + y2 * w2]
}

/**
 * Tessellates a mesh gradient into flat-colored triangles. Deterministic in
 * page space, so every backend renders the identical subdivision.
 */
export function tessellateMeshGradient(
  paint: MeshGradientPaint,
  options?: ShadingTessellationOptions,
): MeshFillTriangle[] {
  const out: MeshFillTriangle[] = []
  for (let i = 0; i < paint.triangles.length; i++) {
    const triangle = paint.triangles[i]!
    if (options?.bounds === undefined || pointArrayIntersectsBounds(triangle.points, options.bounds)) {
      tessellateTriangle(triangle, out, options?.smoothness)
    }
  }
  for (let i = 0; i < paint.patches.length; i++) {
    const patch = paint.patches[i]!
    if (options?.bounds === undefined || pointArrayIntersectsBounds(patch.points, options.bounds)) {
      tessellatePatch(patch, out, options?.smoothness)
    }
  }
  const packedTriangles = paint.packedTriangles
  if (packedTriangles !== undefined) {
    const count = Math.floor(packedTriangles.points.length / 6)
    for (let i = 0; i < count; i++) {
      const pointOffset = i * 6
      if (options?.bounds === undefined || packedPointsIntersectBounds(packedTriangles.points, pointOffset, 6, options.bounds)) {
        tessellateTriangle({
          points: packedTriangles.points.subarray(pointOffset, pointOffset + 6) as unknown as number[],
          colors: [
            packedColor(packedTriangles.colors[i * 3]!),
            packedColor(packedTriangles.colors[i * 3 + 1]!),
            packedColor(packedTriangles.colors[i * 3 + 2]!),
          ],
        }, out, options?.smoothness)
      }
    }
  }
  const packedPatches = paint.packedPatches
  if (packedPatches !== undefined) {
    const count = Math.floor(packedPatches.points.length / 32)
    for (let i = 0; i < count; i++) {
      const pointOffset = i * 32
      if (options?.bounds === undefined || packedPointsIntersectBounds(packedPatches.points, pointOffset, 32, options.bounds)) {
        tessellatePatch({
          points: packedPatches.points.subarray(pointOffset, pointOffset + 32) as unknown as number[],
          colors: [
            packedColor(packedPatches.colors[i * 4]!),
            packedColor(packedPatches.colors[i * 4 + 1]!),
            packedColor(packedPatches.colors[i * 4 + 2]!),
            packedColor(packedPatches.colors[i * 4 + 3]!),
          ],
        }, out, options?.smoothness)
      }
    }
  }
  if (paint.lattice !== undefined) tessellateLattice(paint.lattice, out, options?.smoothness)
  return out
}

function packedPointsIntersectBounds(
  points: Float32Array,
  offset: number,
  length: number,
  bounds: [number, number, number, number],
): boolean {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = offset; i < offset + length; i += 2) {
    minX = Math.min(minX, points[i]!)
    minY = Math.min(minY, points[i + 1]!)
    maxX = Math.max(maxX, points[i]!)
    maxY = Math.max(maxY, points[i + 1]!)
  }
  const overlap = 1
  return maxX + overlap >= bounds[0] && minX - overlap <= bounds[2]
    && maxY + overlap >= bounds[1] && minY - overlap <= bounds[3]
}

function packedColor(value: number): string {
  return '#' + (value & 0xffffff).toString(16).padStart(6, '0')
}

function pointArrayIntersectsBounds(points: readonly number[], bounds: [number, number, number, number]): boolean {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]!)
    minY = Math.min(minY, points[i + 1]!)
    maxX = Math.max(maxX, points[i]!)
    maxY = Math.max(maxY, points[i + 1]!)
  }
  const overlap = 1
  return maxX + overlap >= bounds[0] && minX - overlap <= bounds[2]
    && maxY + overlap >= bounds[1] && minY - overlap <= bounds[3]
}

/** Splits every lattice cell into two Gouraud triangles (same as ShadingType 5). */
function tessellateLattice(
  lattice: { columns: number, points: number[], colors: string[] },
  out: MeshFillTriangle[],
  smoothness: number | undefined,
): void {
  const columns = lattice.columns
  const rows = Math.floor(lattice.points.length / 2 / columns)
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < columns; c++) {
      const i00 = r * columns + c
      const i01 = i00 + 1
      const i10 = i00 + columns
      const i11 = i10 + 1
      tessellateTriangle({
        points: [
          lattice.points[i00 * 2]!, lattice.points[i00 * 2 + 1]!,
          lattice.points[i01 * 2]!, lattice.points[i01 * 2 + 1]!,
          lattice.points[i10 * 2]!, lattice.points[i10 * 2 + 1]!,
        ],
        colors: [lattice.colors[i00]!, lattice.colors[i01]!, lattice.colors[i10]!],
      }, out, smoothness)
      tessellateTriangle({
        points: [
          lattice.points[i01 * 2]!, lattice.points[i01 * 2 + 1]!,
          lattice.points[i11 * 2]!, lattice.points[i11 * 2 + 1]!,
          lattice.points[i10 * 2]!, lattice.points[i10 * 2 + 1]!,
        ],
        colors: [lattice.colors[i01]!, lattice.colors[i11]!, lattice.colors[i10]!],
      }, out, smoothness)
    }
  }
}

// ─── Transform helpers ───

export type PaintMatrix = [number, number, number, number, number, number]

export function transformMeshPaint(paint: MeshGradientPaint, m: PaintMatrix): MeshGradientPaint {
  const result: MeshGradientPaint = {
    type: 'mesh-gradient',
    patches: paint.patches.map(function (patch) {
      return { points: transformPointArray(patch.points, m), colors: patch.colors }
    }),
    triangles: paint.triangles.map(function (triangle) {
      return { points: transformPointArray(triangle.points, m), colors: triangle.colors }
    }),
    packedPatches: transformPackedMesh(paint.packedPatches, m),
    packedTriangles: transformPackedMesh(paint.packedTriangles, m),
    pdfShading: paint.pdfShading === undefined ? undefined : {
      ...paint.pdfShading,
      bbox: paint.pdfShading.bbox === undefined ? undefined : transformPaintBBox(paint.pdfShading.bbox, m),
      native: paint.pdfShading.native === undefined ? undefined : {
        ...paint.pdfShading.native,
        matrix: multiplyPaintMatrix(m, paint.pdfShading.native.matrix),
      },
      nativeFunction: paint.pdfShading.nativeFunction === undefined ? undefined : {
        ...paint.pdfShading.nativeFunction,
        patternMatrix: multiplyPaintMatrix(m, paint.pdfShading.nativeFunction.patternMatrix),
      },
    },
  }
  if (paint.lattice !== undefined) {
    result.lattice = {
      columns: paint.lattice.columns,
      points: transformPointArray(paint.lattice.points, m),
      colors: paint.lattice.colors,
    }
  }
  return result
}

function transformPackedMesh(
  packed: { points: Float32Array, colors: Uint32Array } | undefined,
  m: PaintMatrix,
): { points: Float32Array, colors: Uint32Array } | undefined {
  if (packed === undefined) return undefined
  const points = new Float32Array(packed.points.length)
  for (let i = 0; i < packed.points.length; i += 2) {
    const x = packed.points[i]!
    const y = packed.points[i + 1]!
    points[i] = m[0] * x + m[2] * y + m[4]
    points[i + 1] = m[1] * x + m[3] * y + m[5]
  }
  return { points, colors: packed.colors }
}

function transformPaintBBox(bbox: [number, number, number, number], m: PaintMatrix): [number, number, number, number] {
  const points = transformPointArray([bbox[0], bbox[1], bbox[2], bbox[1], bbox[2], bbox[3], bbox[0], bbox[3]], m)
  let minX = points[0]!
  let minY = points[1]!
  let maxX = minX
  let maxY = minY
  for (let i = 2; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]!)
    minY = Math.min(minY, points[i + 1]!)
    maxX = Math.max(maxX, points[i]!)
    maxY = Math.max(maxY, points[i + 1]!)
  }
  return [minX, minY, maxX, maxY]
}

function transformPointArray(points: number[], m: PaintMatrix): number[] {
  const result: number[] = []
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]!
    const y = points[i + 1]!
    result.push(m[0] * x + m[2] * y + m[4])
    result.push(m[1] * x + m[3] * y + m[5])
  }
  return result
}

export function multiplyPaintMatrix(a: PaintMatrix, b: PaintMatrix): PaintMatrix {
  // Row-vector convention (PDF): p' = p · b · a
  return [
    b[0] * a[0] + b[1] * a[2],
    b[0] * a[1] + b[1] * a[3],
    b[2] * a[0] + b[3] * a[2],
    b[2] * a[1] + b[3] * a[3],
    b[4] * a[0] + b[5] * a[2] + a[4],
    b[4] * a[1] + b[5] * a[3] + a[5],
  ]
}

export function invertPaintMatrix(m: PaintMatrix): PaintMatrix {
  const det = m[0] * m[3] - m[1] * m[2]
  if (det === 0) throw new Error('Tiling pattern matrix is not invertible')
  const ia = m[3] / det
  const ib = -m[1] / det
  const ic = -m[2] / det
  const id = m[0] / det
  return [ia, ib, ic, id, -(m[4] * ia + m[5] * ic), -(m[4] * ib + m[5] * id)]
}

export function transformPaintPoint(x: number, y: number, m: PaintMatrix): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Bounding box of a packed cubic path coordinate array (page space). */
export function pathCoordsBounds(coords: Float32Array): [number, number, number, number] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < coords.length; i += 2) {
    minX = Math.min(minX, coords[i]!)
    maxX = Math.max(maxX, coords[i]!)
    minY = Math.min(minY, coords[i + 1]!)
    maxY = Math.max(maxY, coords[i + 1]!)
  }
  if (minX === Infinity) return [0, 0, 0, 0]
  return [minX, minY, maxX, maxY]
}

/** Conservative paint bounds for a stroked path, including miter protrusion. */
export function pathStrokeBounds(coords: Float32Array, strokeWidth: number, miterLimit: number): [number, number, number, number] {
  const bounds = pathCoordsBounds(coords)
  const outset = Math.max(0, strokeWidth) * 0.5 * Math.max(1, miterLimit)
  return [bounds[0] - outset, bounds[1] - outset, bounds[2] + outset, bounds[3] + outset]
}

/**
 * Tile index range (inclusive) whose cells can intersect the target page
 * area. The target corners map into pattern space through the inverse
 * pattern matrix; the range walks whole xStep/yStep cells covering it.
 */
export function tileIndexRange(
  paint: TilingPatternPaint,
  targetBounds: [number, number, number, number],
): { i0: number, i1: number, j0: number, j1: number } {
  const inverse = invertPaintMatrix(paint.matrix)
  const corners: [number, number][] = [
    transformPaintPoint(targetBounds[0], targetBounds[1], inverse),
    transformPaintPoint(targetBounds[2], targetBounds[1], inverse),
    transformPaintPoint(targetBounds[0], targetBounds[3], inverse),
    transformPaintPoint(targetBounds[2], targetBounds[3], inverse),
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < corners.length; i++) {
    minX = Math.min(minX, corners[i]![0])
    maxX = Math.max(maxX, corners[i]![0])
    minY = Math.min(minY, corners[i]![1])
    maxY = Math.max(maxY, corners[i]![1])
  }
  const [bx0, by0, bx1, by1] = paint.bbox
  return {
    i0: Math.floor((minX - bx1) / paint.xStep),
    i1: Math.ceil((maxX - bx0) / paint.xStep),
    j0: Math.floor((minY - by1) / paint.yStep),
    j1: Math.ceil((maxY - by0) / paint.yStep),
  }
}
