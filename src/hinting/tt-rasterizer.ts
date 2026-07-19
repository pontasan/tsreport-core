import type { TrueTypeHintingState, TrueTypeHintingTransform } from './tt-glyph-hinter.js'

interface Point { x: number, y: number, on: boolean }
interface Segment {
  x0: number
  y0: number
  cx: number
  cy: number
  x1: number
  y1: number
  quadratic: boolean
  contour: number
}
interface RasterProfile {
  readonly contour: number
  readonly direction: number
  readonly start: number
  readonly positions: readonly number[]
  readonly overshootTop: boolean
  readonly overshootBottom: boolean
  next: RasterProfile
}
interface Interval {
  start: number
  end: number
  upProfile: RasterProfile
  downProfile: RasterProfile
}
interface RasterPoint { a: number, b: number }
interface RasterCurve { first: RasterPoint, control: RasterPoint, last: RasterPoint }
interface RasterProfileDraft {
  readonly contour: number
  readonly direction: number
  readonly firstAxis: number
  lastAxis: number
  readonly lines: number[]
  readonly positions: number[]
}
interface RasterProfileBuilder {
  readonly precision: number
  readonly half: number
  readonly step: number
  readonly minimum: number
  readonly maximum: number
  readonly profiles: RasterProfile[]
  current: RasterProfileDraft | null
}

/** Monochrome bitmap in device-pixel coordinates; rows are stored bottom-up. */
export interface TrueTypeRasterBitmap {
  readonly xMin: number
  readonly yMin: number
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
  readonly dropoutControl: boolean
  readonly scanType: number
}

export type TrueTypeRasterTransform = TrueTypeHintingTransform

/** Resolves the SCANCTRL enabling and blocking flags defined by OpenType. */
export function usesTrueTypeDropoutControl(
  scanControl: number,
  ppem: number,
  transform: TrueTypeRasterTransform = {},
): boolean {
  const value = scanControl & 0xFFFF
  const threshold = value & 0xFF
  const small = ppem <= threshold
  const matrix = transform.matrix
  const rotated = transform.rotated ?? (matrix !== undefined && (matrix.xy !== 0 || matrix.yx !== 0))
  const stretched = transform.stretched ?? (matrix !== undefined && Math.abs(
    matrix.xx * matrix.xx + matrix.yx * matrix.yx - matrix.xy * matrix.xy - matrix.yy * matrix.yy,
  ) > 1e-12)
  const enabled = ((value & 0x0100) !== 0 && small)
    || ((value & 0x0200) !== 0 && rotated)
    || ((value & 0x0400) !== 0 && stretched)
  const blocked = ((value & 0x0800) !== 0 && !small)
    || ((value & 0x1000) !== 0 && !rotated)
    || ((value & 0x2000) !== 0 && !stretched)
  return enabled && !blocked
}

/** Scan-converts a grid-fitted TrueType point zone using SCANCTRL/SCANTYPE. */
export function rasterizeTrueTypeHintingState(
  state: TrueTypeHintingState,
  ppem: number,
  transform: TrueTypeRasterTransform = {},
): TrueTypeRasterBitmap {
  const rasterState = transform.matrix === undefined && transform.translateX === undefined && transform.translateY === undefined
    ? state
    : transformHintingState(state, transform)
  const segments = buildSegments(rasterState)
  if (segments.length === 0) {
    return { xMin: 0, yMin: 0, width: 0, height: 0, pixels: new Uint8Array(0), dropoutControl: false, scanType: state.scanType & 7 }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < rasterState.x.length; i++) {
    const x = rasterState.x[i]!, y = rasterState.y[i]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const horizontalBounds = monochromeBounds(minX, maxX)
  const verticalBounds = monochromeBounds(minY, maxY)
  const xMin = horizontalBounds.min
  const yMin = verticalBounds.min
  const xMax = horizontalBounds.max
  const yMax = verticalBounds.max
  const width = xMax - xMin
  const height = yMax - yMin
  const pixels = new Uint8Array(width * height)
  const horizontal = new Array<Interval[]>(height)
  const vertical = new Array<Interval[]>(width)
  const precisionBits = ppem < 24 && width + height - 2 < 256 ? 12 : 6
  const horizontalProfiles = buildRasterProfiles(segments, false, precisionBits, yMin, yMax - 1)
  const verticalProfiles = buildRasterProfiles(segments, true, precisionBits, xMin, xMax - 1)
  for (let row = 0; row < height; row++) {
    horizontal[row] = scanIntervals(horizontalProfiles, yMin + row, precisionBits)
    fillCenters(horizontal[row]!, xMin, width, row, pixels)
  }
  for (let column = 0; column < width; column++) {
    vertical[column] = scanIntervals(verticalProfiles, xMin + column, precisionBits)
  }
  fillAlignedHorizontalEdges(vertical, yMin, width, height, pixels)

  const scanType = state.scanType & 7
  const dropoutControl = usesTrueTypeDropoutControl(state.scanControl, ppem, transform)
    && scanType !== 2 && scanType !== 3 && scanType !== 6 && scanType !== 7
  if (dropoutControl) {
    const smart = scanType === 4 || scanType === 5
    const excludeStubs = scanType === 1 || scanType === 5
    applyDropouts(horizontal, false, smart, excludeStubs, xMin, yMin, width, height, pixels)
    applyDropouts(vertical, true, smart, excludeStubs, xMin, yMin, width, height, pixels)
  }
  return { xMin, yMin, width, height, pixels, dropoutControl, scanType }
}

function transformHintingState(state: TrueTypeHintingState, transform: TrueTypeRasterTransform): TrueTypeHintingState {
  const matrix = transform.matrix ?? { xx: 1, xy: 0, yx: 0, yy: 1 }
  const xx = Math.round(matrix.xx * 65536)
  const xy = Math.round(matrix.xy * 65536)
  const yx = Math.round(matrix.yx * 65536)
  const yy = Math.round(matrix.yy * 65536)
  const dx = Math.round((transform.translateX ?? 0) * 64)
  const dy = Math.round((transform.translateY ?? 0) * 64)
  const x = new Array<number>(state.x.length)
  const y = new Array<number>(state.y.length)
  for (let i = 0; i < x.length; i++) {
    const sourceX = state.x[i]!
    const sourceY = state.y[i]!
    x[i] = fixedMultiply(sourceX, xx) + fixedMultiply(sourceY, xy) + dx
    y[i] = fixedMultiply(sourceX, yx) + fixedMultiply(sourceY, yy) + dy
  }
  return { ...state, x, y }
}

function fixedMultiply(value: number, fixed: number): number {
  const product = value * fixed
  return product < 0 ? -Math.floor((-product + 0x8000) / 0x10000) : Math.floor((product + 0x8000) / 0x10000)
}

function fillAlignedHorizontalEdges(
  intervalsByColumn: readonly Interval[][],
  yMin: number,
  width: number,
  height: number,
  pixels: Uint8Array,
): void {
  for (let column = 0; column < intervalsByColumn.length; column++) {
    const intervals = intervalsByColumn[column]!
    for (let i = 0; i < intervals.length; i++) {
      const interval = intervals[i]!
      const first = Math.ceil((interval.start - 32) / 64)
      const last = Math.floor((interval.end - 32) / 64)
      if (first > last) continue
      setAlignedEdge(interval.start, column, yMin, width, height, pixels)
      setAlignedEdge(interval.end, column, yMin, width, height, pixels)
    }
  }
}

function setAlignedEdge(
  position: number,
  column: number,
  yMin: number,
  width: number,
  height: number,
  pixels: Uint8Array,
): void {
  const pixel = (position - 32) / 64
  const rounded = Math.round(pixel)
  if (Math.abs(pixel - rounded) >= 1e-7) return
  const row = rounded - yMin
  if (row >= 0 && row < height) pixels[row * width + column] = 1
}

function fillCenters(intervals: readonly Interval[], xMin: number, width: number, row: number, pixels: Uint8Array): void {
  for (let i = 0; i < intervals.length; i++) {
    const interval = intervals[i]!
    const first = Math.ceil((interval.start - 32) / 64)
    const last = Math.floor((interval.end - 32) / 64)
    for (let x = first; x <= last; x++) {
      const column = x - xMin
      if (column >= 0 && column < width) pixels[row * width + column] = 1
    }
  }
}

function applyDropouts(
  lines: readonly Interval[][],
  vertical: boolean,
  smart: boolean,
  excludeStubs: boolean,
  xMin: number,
  yMin: number,
  width: number,
  height: number,
  pixels: Uint8Array,
): void {
  for (let line = 0; line < lines.length; line++) {
    const intervals = lines[line]!
    for (let i = 0; i < intervals.length; i++) {
      const interval = intervals[i]!
      if (containsPixelCenter(interval)) continue
      if (excludeStubs) {
        const span = interval.end - interval.start
        const scan = (vertical ? xMin : yMin) + line
        const topStub = scan === interval.upProfile.start + interval.upProfile.positions.length - 1
          && interval.upProfile.next === interval.downProfile
        if (topStub && (!interval.upProfile.overshootTop || span < 32)) continue
        const bottomStub = scan === interval.upProfile.start
          && interval.downProfile.next === interval.upProfile
        if (bottomStub && (!interval.upProfile.overshootBottom || span < 32)) continue
      }
      let pixel: number
      let alternate: number
      if (smart) {
        pixel = Math.floor((interval.start + interval.end - 1) / 128)
        alternate = interval.start - 32 > pixel * 64 ? pixel + 1 : pixel - 1
      } else {
        pixel = Math.floor((interval.end - 32) / 64)
        alternate = Math.ceil((interval.start - 32) / 64)
      }
      const axisMin = vertical ? yMin : xMin
      const axisMax = axisMin + (vertical ? height : width) - 1
      if (pixel < axisMin || pixel > axisMax) {
        pixel = alternate
      } else if (alternate >= axisMin && alternate <= axisMax) {
        const alternateColumn = vertical ? line : alternate - xMin
        const alternateRow = vertical ? alternate - yMin : line
        if (pixels[alternateRow * width + alternateColumn] !== 0) continue
      }
      const column = vertical ? line : pixel - xMin
      const row = vertical ? pixel - yMin : line
      if (column >= 0 && column < width && row >= 0 && row < height) pixels[row * width + column] = 1
    }
  }
}

function monochromeBounds(minimum: number, maximum: number): { min: number, max: number } {
  let min = Math.floor((minimum + 31) / 64)
  let max = Math.floor((maximum + 32) / 64)
  if (min === max) {
    const minRemainder = positiveModulo(minimum, 64)
    const maxRemainder = positiveModulo(maximum, 64)
    const minError = positiveModulo(minRemainder + 31, 64) - 31
    const maxError = positiveModulo(maxRemainder + 32, 64) - 32
    if (minError + maxError < 0) min--
    else max++
  }
  return { min, max }
}

function positiveModulo(value: number, modulus: number): number {
  const remainder = value % modulus
  return remainder < 0 ? remainder + modulus : remainder
}

function containsPixelCenter(interval: Interval): boolean {
  const first = Math.ceil((interval.start - 32) / 64) * 64 + 32
  return first <= interval.end
}

function scanIntervals(profiles: readonly RasterProfile[], scan: number, precisionBits: number): Interval[] {
  const scale = 1 << (precisionBits - 6)
  const half = 1 << (precisionBits - 1)
  const ascending: Array<{ position: number, profile: RasterProfile }> = []
  const descending: Array<{ position: number, profile: RasterProfile }> = []
  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i]!
    const offset = scan - profile.start
    if (offset < 0 || offset >= profile.positions.length) continue
    const crossing = { position: (profile.positions[offset]! + half) / scale, profile }
    if (profile.direction > 0) ascending.push(crossing)
    else descending.push(crossing)
  }
  ascending.sort(sortCrossing)
  descending.sort(sortCrossing)
  const intervals: Interval[] = []
  const count = Math.min(ascending.length, descending.length)
  for (let i = 0; i < count; i++) {
    const up = ascending[i]!
    const down = descending[i]!
    intervals.push({
      start: Math.min(up.position, down.position),
      end: Math.max(up.position, down.position),
      upProfile: up.profile,
      downProfile: down.profile,
    })
  }
  return intervals
}

function sortCrossing(left: { position: number }, right: { position: number }): number {
  return left.position - right.position
}

function buildRasterProfiles(
  segments: readonly Segment[],
  vertical: boolean,
  precisionBits: number,
  minimumScan: number,
  maximumScan: number,
): RasterProfile[] {
  const precision = 1 << precisionBits
  const scale = 1 << (precisionBits - 6)
  const half = precision >> 1
  const builder: RasterProfileBuilder = {
    precision,
    half,
    step: precisionBits === 12 ? 256 : 32,
    minimum: minimumScan * precision,
    maximum: maximumScan * precision,
    profiles: [],
    current: null,
  }
  let contourStart = 0
  while (contourStart < segments.length) {
    const contour = segments[contourStart]!.contour
    let contourEnd = contourStart + 1
    while (contourEnd < segments.length && segments[contourEnd]!.contour === contour) contourEnd++
    const firstProfile = builder.profiles.length
    for (let i = contourStart; i < contourEnd; i++) {
      const segment = segments[i]!
      const first = scaledRasterPoint(segment.x0, segment.y0, vertical, scale, half)
      const last = scaledRasterPoint(segment.x1, segment.y1, vertical, scale, half)
      if (segment.quadratic) {
        const control = scaledRasterPoint(segment.cx, segment.cy, vertical, scale, half)
        processQuadraticProfile(builder, contour, first, control, last)
      } else {
        processLineProfile(builder, contour, first, last)
      }
    }
    finishRasterProfile(builder)
    linkContourProfiles(builder.profiles, firstProfile)
    contourStart = contourEnd
  }
  return builder.profiles
}

function scaledRasterPoint(x: number, y: number, vertical: boolean, scale: number, half: number): RasterPoint {
  return vertical
    ? { a: x * scale - half, b: y * scale - half }
    : { a: y * scale - half, b: x * scale - half }
}

function processLineProfile(builder: RasterProfileBuilder, contour: number, first: RasterPoint, last: RasterPoint): void {
  if (first.a === last.a) {
    if (builder.current !== null) builder.current.lastAxis = last.a
    return
  }
  const direction = first.a < last.a ? 1 : -1
  startRasterProfile(builder, contour, direction, first)
  emitLineIntersections(builder, first, last, direction)
  builder.current!.lastAxis = last.a
}

function processQuadraticProfile(
  builder: RasterProfileBuilder,
  contour: number,
  first: RasterPoint,
  control: RasterPoint,
  last: RasterPoint,
): void {
  const minimum = Math.min(first.a, last.a)
  const maximum = Math.max(first.a, last.a)
  if (control.a < floorPrecision(minimum, builder.precision)
    || control.a > ceilPrecision(maximum, builder.precision)) {
    const split = splitRasterCurve({ first, control, last })
    processQuadraticProfile(builder, contour, split.left.first, split.left.control, split.left.last)
    processQuadraticProfile(builder, contour, split.right.first, split.right.control, split.right.last)
    return
  }
  if (first.a !== last.a) {
    const direction = first.a < last.a ? 1 : -1
    startRasterProfile(builder, contour, direction, first)
    emitQuadraticIntersections(builder, { first, control, last }, direction)
  }
  if (builder.current !== null) builder.current.lastAxis = last.a
}

function startRasterProfile(
  builder: RasterProfileBuilder,
  contour: number,
  direction: number,
  first: RasterPoint,
): void {
  if (builder.current !== null && builder.current.direction === direction) return
  finishRasterProfile(builder)
  const draft: RasterProfileDraft = {
    contour,
    direction,
    firstAxis: first.a,
    lastAxis: first.a,
    lines: [],
    positions: [],
  }
  builder.current = draft
  let edge = direction > 0
    ? ceilPrecision(first.a, builder.precision)
    : floorPrecision(first.a, builder.precision)
  if (edge < builder.minimum) edge = builder.minimum
  if (edge > builder.maximum) edge = builder.maximum
  if (first.a === edge) appendProfileIntersection(draft, edge / builder.precision, first.b)
}

function finishRasterProfile(builder: RasterProfileBuilder): void {
  const draft = builder.current
  if (draft === null) return
  builder.current = null
  if (draft.positions.length === 0) return
  if (draft.direction < 0) {
    draft.lines.reverse()
    draft.positions.reverse()
  }
  const start = draft.lines[0]!
  const positions: number[] = []
  for (let i = 0; i < draft.lines.length; i++) {
    if (draft.lines[i] !== start + i) throw new Error('Non-contiguous TrueType raster profile')
    positions.push(draft.positions[i]!)
  }
  const profile = {
    contour: draft.contour,
    direction: draft.direction,
    start,
    positions,
    overshootTop: draft.direction > 0
      ? isTopOvershoot(draft.lastAxis, builder.precision, builder.half)
      : isTopOvershoot(draft.firstAxis, builder.precision, builder.half),
    overshootBottom: draft.direction > 0
      ? isBottomOvershoot(draft.firstAxis, builder.precision, builder.half)
      : isBottomOvershoot(draft.lastAxis, builder.precision, builder.half),
    next: null as unknown as RasterProfile,
  }
  builder.profiles.push(profile)
}

function linkContourProfiles(profiles: RasterProfile[], start: number): void {
  const count = profiles.length - start
  if (count === 0) return
  for (let i = 0; i < count; i++) profiles[start + i]!.next = profiles[start + (i + 1) % count]!
}

function emitLineIntersections(
  builder: RasterProfileBuilder,
  first: RasterPoint,
  last: RasterPoint,
  direction: number,
): void {
  if (direction > 0) {
    let target = Math.max(builder.minimum, ceilPrecision(first.a, builder.precision))
    const end = Math.min(builder.maximum, floorPrecision(last.a, builder.precision))
    if (first.a === target) target += builder.precision
    for (; target <= end; target += builder.precision) {
      const position = first.b + truncateDivision((target - first.a) * (last.b - first.b), last.a - first.a)
      appendProfileIntersection(builder.current!, target / builder.precision, position)
    }
  } else {
    let target = Math.min(builder.maximum, floorPrecision(first.a, builder.precision))
    const end = Math.max(builder.minimum, ceilPrecision(last.a, builder.precision))
    if (first.a === target) target -= builder.precision
    for (; target >= end; target -= builder.precision) {
      const position = first.b + truncateDivision((first.a - target) * (last.b - first.b), first.a - last.a)
      appendProfileIntersection(builder.current!, target / builder.precision, position)
    }
  }
}

function emitQuadraticIntersections(
  builder: RasterProfileBuilder,
  curve: RasterCurve,
  direction: number,
): void {
  let normalized = curve
  let minimum = builder.minimum
  let maximum = builder.maximum
  if (direction < 0) {
    normalized = negateRasterCurveAxis(curve)
    minimum = -builder.maximum
    maximum = -builder.minimum
  }
  let target = Math.max(minimum, ceilPrecision(normalized.first.a, builder.precision))
  const end = Math.min(maximum, floorPrecision(normalized.last.a, builder.precision))
  if (normalized.first.a === target) target += builder.precision
  const pending: RasterCurve[] = [normalized]
  let current = 0
  while (target <= end && current < pending.length) {
    const active = pending[current]!
    if (active.last.a > target) {
      const deltaA = active.last.a - active.first.a
      const deltaB = active.last.b - active.first.b
      if (deltaA > builder.step || Math.abs(deltaB) > builder.step) {
        const split = splitRasterCurve(active)
        pending[current] = split.left
        pending.splice(current + 1, 0, split.right)
      } else {
        const position = active.last.b
          - truncateDivision((active.last.a - target) * deltaB, deltaA)
        const scan = direction > 0 ? target / builder.precision : -target / builder.precision
        appendProfileIntersection(builder.current!, scan, position)
        target += builder.precision
        current++
      }
    } else {
      if (active.last.a === target) {
        const scan = direction > 0 ? target / builder.precision : -target / builder.precision
        appendProfileIntersection(builder.current!, scan, active.last.b)
        target += builder.precision
      }
      current++
    }
  }
}

function appendProfileIntersection(profile: RasterProfileDraft, scan: number, position: number): void {
  profile.lines.push(scan)
  profile.positions.push(position)
}

function splitRasterCurve(curve: RasterCurve): { left: RasterCurve, right: RasterCurve } {
  const firstControl = {
    a: floorHalf(curve.first.a + curve.control.a),
    b: floorHalf(curve.first.b + curve.control.b),
  }
  const lastControl = {
    a: floorHalf(curve.control.a + curve.last.a),
    b: floorHalf(curve.control.b + curve.last.b),
  }
  const middle = {
    a: floorQuarter(curve.first.a + 2 * curve.control.a + curve.last.a),
    b: floorQuarter(curve.first.b + 2 * curve.control.b + curve.last.b),
  }
  return {
    left: { first: curve.first, control: firstControl, last: middle },
    right: { first: middle, control: lastControl, last: curve.last },
  }
}

function negateRasterCurveAxis(curve: RasterCurve): RasterCurve {
  return {
    first: { a: -curve.first.a, b: curve.first.b },
    control: { a: -curve.control.a, b: curve.control.b },
    last: { a: -curve.last.a, b: curve.last.b },
  }
}

function floorPrecision(value: number, precision: number): number {
  return Math.floor(value / precision) * precision
}

function ceilPrecision(value: number, precision: number): number {
  return Math.ceil(value / precision) * precision
}

function isTopOvershoot(value: number, precision: number, half: number): boolean {
  return value - floorPrecision(value, precision) >= half
}

function isBottomOvershoot(value: number, precision: number, half: number): boolean {
  return ceilPrecision(value, precision) - value >= half
}

function truncateDivision(numerator: number, denominator: number): number {
  return Math.trunc(numerator / denominator)
}

function floorHalf(value: number): number {
  return Math.floor(value / 2)
}

function floorQuarter(value: number): number {
  return Math.floor(value / 4)
}

function buildSegments(state: TrueTypeHintingState): Segment[] {
  const segments: Segment[] = []
  let start = 0
  for (let contour = 0; contour < state.contourEnds.length; contour++) {
    const end = state.contourEnds[contour]!
    const nodes: Point[] = []
    for (let i = start; i <= end; i++) nodes.push({ x: state.x[i]!, y: state.y[i]!, on: state.onCurve[i]! })
    insertImpliedPoints(nodes)
    let firstOn = -1
    for (let i = 0; i < nodes.length; i++) if (nodes[i]!.on) { firstOn = i; break }
    if (firstOn >= 0) {
      appendContourSegments(nodes, firstOn, contour, segments)
    }
    start = end + 1
  }
  return segments
}

function insertImpliedPoints(nodes: Point[]): void {
  if (nodes.length === 0) return
  const expanded: Point[] = []
  for (let i = 0; i < nodes.length; i++) {
    const current = nodes[i]!
    const next = nodes[(i + 1) % nodes.length]!
    expanded.push(current)
    if (!current.on && !next.on) expanded.push({ x: (current.x + next.x) / 2, y: (current.y + next.y) / 2, on: true })
  }
  nodes.length = 0
  for (let i = 0; i < expanded.length; i++) nodes.push(expanded[i]!)
}

function appendContourSegments(nodes: readonly Point[], firstOn: number, contour: number, result: Segment[]): void {
  let current = nodes[firstOn]!
  let step = 1
  while (step <= nodes.length) {
    const next = nodes[(firstOn + step) % nodes.length]!
    if (next.on) {
      result.push({ x0: current.x, y0: current.y, cx: 0, cy: 0, x1: next.x, y1: next.y, quadratic: false, contour })
      current = next
      step++
    } else {
      const end = nodes[(firstOn + step + 1) % nodes.length]!
      result.push({ x0: current.x, y0: current.y, cx: next.x, cy: next.y, x1: end.x, y1: end.y, quadratic: true, contour })
      current = end
      step += 2
    }
  }
}
