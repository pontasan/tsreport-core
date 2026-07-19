/** A path whose cubic curves have been reduced to device-tolerance line segments. */
export interface FlattenedPdfPath {
  commands: Uint8Array
  coords: Float32Array
}

export interface PdfDeviceMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * Quantizes a stroke width to the nearest representable device-pixel width.
 * Widths below half a pixel and PDF hairlines are rendered as one pixel.
 */
export function adjustPdfStrokeWidth(lineWidth: number, matrix: PdfDeviceMatrix): number {
  if (!Number.isFinite(lineWidth) || lineWidth < 0) throw new Error('PDF stroke width must be a non-negative finite number')
  const scale = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c))
  if (!(scale > 0)) throw new Error('PDF stroke adjustment requires a non-singular device transform')
  const deviceWidth = lineWidth * scale
  const adjustedPixels = deviceWidth < 0.5 ? 1 : Math.max(1, Math.round(deviceWidth))
  return adjustedPixels / scale
}

/**
 * Moves path coordinates to the device grid selected by the adjusted stroke
 * width, then maps them back to user space. This applies the same device model
 * to lines, curves, rectangles, and glyph-outline strokes.
 */
export function adjustPdfStrokePath(
  coords: Float32Array,
  lineWidth: number,
  matrix: PdfDeviceMatrix,
): Float32Array {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (determinant === 0) throw new Error('PDF stroke adjustment requires a non-singular device transform')
  const adjustedWidth = adjustPdfStrokeWidth(lineWidth, matrix)
  const deviceScale = Math.sqrt(Math.abs(determinant))
  const devicePixels = Math.max(1, Math.round(adjustedWidth * deviceScale))
  const phase = (devicePixels & 1) === 0 ? 0 : 0.5
  const output = new Float32Array(coords.length)
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i]!
    const y = coords[i + 1]!
    const deviceX = matrix.a * x + matrix.c * y + matrix.e
    const deviceY = matrix.b * x + matrix.d * y + matrix.f
    const snappedX = Math.round(deviceX - phase) + phase
    const snappedY = Math.round(deviceY - phase) + phase
    const translatedX = snappedX - matrix.e
    const translatedY = snappedY - matrix.f
    output[i] = (matrix.d * translatedX - matrix.c * translatedY) / determinant
    output[i + 1] = (-matrix.b * translatedX + matrix.a * translatedY) / determinant
  }
  return output
}

/**
 * Flattens cubic segments using the PDF flatness tolerance expressed in user
 * space. The subdivision criterion is the maximum perpendicular distance of
 * either control point from the endpoint chord.
 */
export function flattenPdfPath(
  commands: Uint8Array,
  coords: Float32Array,
  tolerance: number,
): FlattenedPdfPath {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('PDF path flatness tolerance must be positive')
  const outputCommands: number[] = []
  const outputCoords: number[] = []
  const stack: number[] = []
  const toleranceSquared = tolerance * tolerance
  let coordinate = 0
  let currentX = 0
  let currentY = 0
  let startX = 0
  let startY = 0

  for (let command = 0; command < commands.length; command++) {
    const kind = commands[command]!
    if (kind === 0) {
      currentX = coords[coordinate]!
      currentY = coords[coordinate + 1]!
      coordinate += 2
      startX = currentX
      startY = currentY
      outputCommands.push(0)
      outputCoords.push(currentX, currentY)
      continue
    }
    if (kind === 1) {
      currentX = coords[coordinate]!
      currentY = coords[coordinate + 1]!
      coordinate += 2
      outputCommands.push(1)
      outputCoords.push(currentX, currentY)
      continue
    }
    if (kind === 3) {
      outputCommands.push(3)
      currentX = startX
      currentY = startY
      continue
    }

    const control1X = coords[coordinate]!
    const control1Y = coords[coordinate + 1]!
    const control2X = coords[coordinate + 2]!
    const control2Y = coords[coordinate + 3]!
    const endX = coords[coordinate + 4]!
    const endY = coords[coordinate + 5]!
    coordinate += 6
    stack.push(currentX, currentY, control1X, control1Y, control2X, control2Y, endX, endY)
    while (stack.length !== 0) {
      const y3 = stack.pop()!
      const x3 = stack.pop()!
      const y2 = stack.pop()!
      const x2 = stack.pop()!
      const y1 = stack.pop()!
      const x1 = stack.pop()!
      const y0 = stack.pop()!
      const x0 = stack.pop()!
      if (cubicIsFlat(x0, y0, x1, y1, x2, y2, x3, y3, toleranceSquared)) {
        outputCommands.push(1)
        outputCoords.push(x3, y3)
        continue
      }
      const x01 = (x0 + x1) / 2
      const y01 = (y0 + y1) / 2
      const x12 = (x1 + x2) / 2
      const y12 = (y1 + y2) / 2
      const x23 = (x2 + x3) / 2
      const y23 = (y2 + y3) / 2
      const x012 = (x01 + x12) / 2
      const y012 = (y01 + y12) / 2
      const x123 = (x12 + x23) / 2
      const y123 = (y12 + y23) / 2
      const middleX = (x012 + x123) / 2
      const middleY = (y012 + y123) / 2
      stack.push(middleX, middleY, x123, y123, x23, y23, x3, y3)
      stack.push(x0, y0, x01, y01, x012, y012, middleX, middleY)
    }
    currentX = endX
    currentY = endY
  }
  return { commands: Uint8Array.from(outputCommands), coords: Float32Array.from(outputCoords) }
}

function cubicIsFlat(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  toleranceSquared: number,
): boolean {
  const dx = x3 - x0
  const dy = y3 - y0
  const chordSquared = dx * dx + dy * dy
  if (chordSquared === 0) {
    const d1x = x1 - x0
    const d1y = y1 - y0
    const d2x = x2 - x0
    const d2y = y2 - y0
    return Math.max(d1x * d1x + d1y * d1y, d2x * d2x + d2y * d2y) <= toleranceSquared
  }
  const cross1 = dy * (x1 - x0) - dx * (y1 - y0)
  const cross2 = dy * (x2 - x0) - dx * (y2 - y0)
  return Math.max(cross1 * cross1, cross2 * cross2) <= toleranceSquared * chordSquared
}
