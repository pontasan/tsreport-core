import type { MeshGradientPaint } from './backend.js'

export interface DeviceTransform {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface PackedMeshRaster {
  x: number
  y: number
  width: number
  height: number
  data: Uint8ClampedArray
}

const CELL_SIZE_PX = 8
const MAX_SEGMENTS = 32
const SEAM_COVERAGE_PX = 0.75

/** Rasterizes compact tensor patches directly in device space. */
export function rasterizePackedMesh(
  paint: MeshGradientPaint,
  matrix: DeviceTransform,
  surfaceWidth: number,
  surfaceHeight: number,
): PackedMeshRaster | null {
  const packed = paint.packedPatches
  if (packed === undefined || packed.points.length === 0) return null
  const bounds = packedDeviceBounds(packed.points, matrix, surfaceWidth, surfaceHeight)
  if (bounds === null) return null
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  const data = new Uint8ClampedArray(width * height * 4)
  const gridPoints = new Float64Array((MAX_SEGMENTS + 1) * (MAX_SEGMENTS + 1) * 2)
  const gridColors = new Uint32Array((MAX_SEGMENTS + 1) * (MAX_SEGMENTS + 1))
  const patchCount = Math.min(Math.floor(packed.points.length / 32), Math.floor(packed.colors.length / 4))
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
    rasterizePatch(
      packed.points,
      patchIndex * 32,
      packed.colors,
      patchIndex * 4,
      matrix,
      bounds.left,
      bounds.top,
      width,
      height,
      data,
      gridPoints,
      gridColors,
    )
  }
  return { x: bounds.left, y: bounds.top, width, height, data }
}

function packedDeviceBounds(
  points: Float32Array,
  matrix: DeviceTransform,
  surfaceWidth: number,
  surfaceHeight: number,
): { left: number, top: number, right: number, bottom: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]!
    const y = points[i + 1]!
    const deviceX = matrix.a * x + matrix.c * y + matrix.e
    const deviceY = matrix.b * x + matrix.d * y + matrix.f
    if (deviceX < minX) minX = deviceX
    if (deviceX > maxX) maxX = deviceX
    if (deviceY < minY) minY = deviceY
    if (deviceY > maxY) maxY = deviceY
  }
  const left = Math.max(0, Math.floor(minX) - 1)
  const top = Math.max(0, Math.floor(minY) - 1)
  const right = Math.min(surfaceWidth, Math.ceil(maxX) + 1)
  const bottom = Math.min(surfaceHeight, Math.ceil(maxY) + 1)
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom }
}

function rasterizePatch(
  points: Float32Array,
  pointOffset: number,
  colors: Uint32Array,
  colorOffset: number,
  matrix: DeviceTransform,
  originX: number,
  originY: number,
  width: number,
  height: number,
  data: Uint8ClampedArray,
  gridPoints: Float64Array,
  gridColors: Uint32Array,
): void {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = pointOffset; i < pointOffset + 32; i += 2) {
    const x = points[i]!
    const y = points[i + 1]!
    const deviceX = matrix.a * x + matrix.c * y + matrix.e
    const deviceY = matrix.b * x + matrix.d * y + matrix.f
    if (deviceX < minX) minX = deviceX
    if (deviceX > maxX) maxX = deviceX
    if (deviceY < minY) minY = deviceY
    if (deviceY > maxY) maxY = deviceY
  }
  if (maxX < originX || maxY < originY || minX >= originX + width || minY >= originY + height) return
  const segments = Math.max(1, Math.min(MAX_SEGMENTS, Math.ceil(Math.max(maxX - minX, maxY - minY) / CELL_SIZE_PX)))
  const gridSize = segments + 1
  for (let uIndex = 0; uIndex <= segments; uIndex++) {
    const u = uIndex / segments
    for (let vIndex = 0; vIndex <= segments; vIndex++) {
      const v = vIndex / segments
      const gridIndex = uIndex * gridSize + vIndex
      writePatchPoint(points, pointOffset, u, v, matrix, originX, originY, gridPoints, gridIndex * 2)
      gridColors[gridIndex] = patchColor(colors, colorOffset, u, v)
    }
  }
  for (let uIndex = 0; uIndex < segments; uIndex++) {
    for (let vIndex = 0; vIndex < segments; vIndex++) {
      const i00 = uIndex * gridSize + vIndex
      const i01 = i00 + 1
      const i10 = i00 + gridSize
      const i11 = i10 + 1
      rasterizeTriangle(gridPoints, gridColors, i00, i01, i11, width, height, data)
      rasterizeTriangle(gridPoints, gridColors, i00, i11, i10, width, height, data)
    }
  }
}

function writePatchPoint(
  points: Float32Array,
  offset: number,
  u: number,
  v: number,
  matrix: DeviceTransform,
  originX: number,
  originY: number,
  output: Float64Array,
  outputOffset: number,
): void {
  const x0 = bezier(points[offset]!, points[offset + 2]!, points[offset + 4]!, points[offset + 6]!, v)
  const y0 = bezier(points[offset + 1]!, points[offset + 3]!, points[offset + 5]!, points[offset + 7]!, v)
  const x1 = bezier(points[offset + 8]!, points[offset + 10]!, points[offset + 12]!, points[offset + 14]!, v)
  const y1 = bezier(points[offset + 9]!, points[offset + 11]!, points[offset + 13]!, points[offset + 15]!, v)
  const x2 = bezier(points[offset + 16]!, points[offset + 18]!, points[offset + 20]!, points[offset + 22]!, v)
  const y2 = bezier(points[offset + 17]!, points[offset + 19]!, points[offset + 21]!, points[offset + 23]!, v)
  const x3 = bezier(points[offset + 24]!, points[offset + 26]!, points[offset + 28]!, points[offset + 30]!, v)
  const y3 = bezier(points[offset + 25]!, points[offset + 27]!, points[offset + 29]!, points[offset + 31]!, v)
  const x = bezier(x0, x1, x2, x3, u)
  const y = bezier(y0, y1, y2, y3, u)
  output[outputOffset] = matrix.a * x + matrix.c * y + matrix.e - originX
  output[outputOffset + 1] = matrix.b * x + matrix.d * y + matrix.f - originY
}

function bezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

function patchColor(colors: Uint32Array, offset: number, u: number, v: number): number {
  const c00 = colors[offset]!
  const c01 = colors[offset + 1]!
  const c11 = colors[offset + 2]!
  const c10 = colors[offset + 3]!
  const w00 = (1 - u) * (1 - v)
  const w01 = (1 - u) * v
  const w11 = u * v
  const w10 = u * (1 - v)
  const r = Math.round(((c00 >> 16) & 0xff) * w00 + ((c01 >> 16) & 0xff) * w01 + ((c11 >> 16) & 0xff) * w11 + ((c10 >> 16) & 0xff) * w10)
  const g = Math.round(((c00 >> 8) & 0xff) * w00 + ((c01 >> 8) & 0xff) * w01 + ((c11 >> 8) & 0xff) * w11 + ((c10 >> 8) & 0xff) * w10)
  const b = Math.round((c00 & 0xff) * w00 + (c01 & 0xff) * w01 + (c11 & 0xff) * w11 + (c10 & 0xff) * w10)
  return (r << 16) | (g << 8) | b
}

function rasterizeTriangle(
  points: Float64Array,
  colors: Uint32Array,
  index0: number,
  index1: number,
  index2: number,
  width: number,
  height: number,
  data: Uint8ClampedArray,
): void {
  const x0 = points[index0 * 2]!
  const y0 = points[index0 * 2 + 1]!
  const x1 = points[index1 * 2]!
  const y1 = points[index1 * 2 + 1]!
  const x2 = points[index2 * 2]!
  const y2 = points[index2 * 2 + 1]!
  const denominator = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
  if (Math.abs(denominator) < 1e-8) return
  const left = Math.max(0, Math.floor(Math.min(x0, x1, x2) - SEAM_COVERAGE_PX))
  const top = Math.max(0, Math.floor(Math.min(y0, y1, y2) - SEAM_COVERAGE_PX))
  const right = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2) + SEAM_COVERAGE_PX))
  const bottom = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2) + SEAM_COVERAGE_PX))
  const c0 = colors[index0]!
  const c1 = colors[index1]!
  const c2 = colors[index2]!
  const inv = 1 / denominator
  const inverseArea = 1 / Math.abs(denominator)
  const tolerance0 = SEAM_COVERAGE_PX * Math.hypot(x1 - x2, y1 - y2) * inverseArea
  const tolerance1 = SEAM_COVERAGE_PX * Math.hypot(x2 - x0, y2 - y0) * inverseArea
  const tolerance2 = SEAM_COVERAGE_PX * Math.hypot(x0 - x1, y0 - y1) * inverseArea
  for (let y = top; y <= bottom; y++) {
    const py = y + 0.5
    for (let x = left; x <= right; x++) {
      const px = x + 0.5
      const w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) * inv
      const w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) * inv
      const w2 = 1 - w0 - w1
      if (w0 < -tolerance0 || w1 < -tolerance1 || w2 < -tolerance2) continue
      const offset = (y * width + x) * 4
      data[offset] = ((c0 >> 16) & 0xff) * w0 + ((c1 >> 16) & 0xff) * w1 + ((c2 >> 16) & 0xff) * w2
      data[offset + 1] = ((c0 >> 8) & 0xff) * w0 + ((c1 >> 8) & 0xff) * w1 + ((c2 >> 8) & 0xff) * w2
      data[offset + 2] = (c0 & 0xff) * w0 + (c1 & 0xff) * w1 + (c2 & 0xff) * w2
      data[offset + 3] = 255
    }
  }
}
