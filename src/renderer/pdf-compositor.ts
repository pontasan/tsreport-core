import type { BlendMode } from '../types/render.js'

/** Composite one PDF transparency object into an RGBA group accumulator. */
export function compositePdfTransparencyObject(
  accumulator: Uint8ClampedArray,
  initialBackdrop: Uint8ClampedArray,
  source: Uint8ClampedArray,
  groupAlpha: Uint8ClampedArray,
  groupShape: Uint8ClampedArray,
  shape: Uint8ClampedArray,
  knockout: boolean,
  blendMode: BlendMode,
): void {
  if (accumulator.length !== initialBackdrop.length || accumulator.length !== source.length) {
    throw new Error('PDF transparency buffers must have identical RGBA lengths')
  }
  const pixels = accumulator.length / 4
  if (groupAlpha.length !== pixels || groupShape.length !== pixels || shape.length !== pixels) throw new Error('PDF transparency alpha buffers must match the pixel count')
  for (let pixel = 0, offset = 0; pixel < pixels; pixel++, offset += 4) {
    const sourceAlpha = source[offset + 3]! / 255
    const oldGroupAlpha = groupAlpha[pixel]! / 255
    const objectShape = shape[pixel]! / 255
    const oldGroupShape = groupShape[pixel]! / 255
    groupAlpha[pixel] = Math.round((sourceAlpha + oldGroupAlpha * (1 - (knockout ? objectShape : sourceAlpha))) * 255)
    groupShape[pixel] = Math.round((objectShape + oldGroupShape * (1 - objectShape)) * 255)
    if (sourceAlpha === 0) continue
    const backdrop = knockout ? initialBackdrop : accumulator
    const result = compositePdfPixel(backdrop, offset, source, offset, blendMode)
    if (knockout) {
      const currentAlpha = accumulator[offset + 3]! / 255
      const resultAlpha = result[3]
      const outputAlpha = resultAlpha * objectShape + currentAlpha * (1 - objectShape)
      for (let component = 0; component < 3; component++) {
        const resultPremultiplied = result[component]! * resultAlpha
        const currentPremultiplied = accumulator[offset + component]! / 255 * currentAlpha
        const premultiplied = resultPremultiplied * objectShape + currentPremultiplied * (1 - objectShape)
        accumulator[offset + component] = outputAlpha === 0 ? 0 : Math.round(premultiplied / outputAlpha * 255)
      }
      accumulator[offset + 3] = Math.round(outputAlpha * 255)
    } else {
      accumulator[offset] = Math.round(result[0]! * 255)
      accumulator[offset + 1] = Math.round(result[1]! * 255)
      accumulator[offset + 2] = Math.round(result[2]! * 255)
      accumulator[offset + 3] = Math.round(result[3] * 255)
    }
  }
}

/** Remove a non-isolated group's initial backdrop before it is painted back. */
export function extractPdfTransparencyGroup(
  accumulated: Uint8ClampedArray,
  initialBackdrop: Uint8ClampedArray,
  groupAlpha: Uint8ClampedArray,
  isolated: boolean,
): void {
  if (accumulated.length !== initialBackdrop.length || groupAlpha.length !== accumulated.length / 4) {
    throw new Error('PDF transparency group buffers have incompatible lengths')
  }
  for (let pixel = 0, offset = 0; offset < accumulated.length; pixel++, offset += 4) {
    const alpha = groupAlpha[pixel]! / 255
    if (alpha === 0) {
      accumulated[offset] = 0
      accumulated[offset + 1] = 0
      accumulated[offset + 2] = 0
      accumulated[offset + 3] = 0
      continue
    }
    if (!isolated) {
      const finalAlpha = accumulated[offset + 3]! / 255
      const backdropAlpha = initialBackdrop[offset + 3]! / 255
      for (let component = 0; component < 3; component++) {
        const finalPremultiplied = accumulated[offset + component]! / 255 * finalAlpha
        const backdropPremultiplied = initialBackdrop[offset + component]! / 255 * backdropAlpha
        const groupPremultiplied = finalPremultiplied - backdropPremultiplied * (1 - alpha)
        accumulated[offset + component] = Math.round(clamp01(groupPremultiplied / alpha) * 255)
      }
    }
    accumulated[offset + 3] = Math.round(alpha * 255)
  }
}

export function compositePdfPixel(
  backdrop: Uint8ClampedArray,
  backdropOffset: number,
  source: Uint8ClampedArray,
  sourceOffset: number,
  mode: BlendMode,
): [number, number, number, number] {
  const sourceAlpha = source[sourceOffset + 3]! / 255
  const backdropAlpha = backdrop[backdropOffset + 3]! / 255
  const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha)
  if (outputAlpha === 0) return [0, 0, 0, 0]
  const sourceColor: [number, number, number] = [source[sourceOffset]! / 255, source[sourceOffset + 1]! / 255, source[sourceOffset + 2]! / 255]
  const backdropColor: [number, number, number] = [backdrop[backdropOffset]! / 255, backdrop[backdropOffset + 1]! / 255, backdrop[backdropOffset + 2]! / 255]
  const blended = blendPdfColor(backdropColor, sourceColor, mode)
  const output: [number, number, number, number] = [0, 0, 0, outputAlpha]
  for (let component = 0; component < 3; component++) {
    const premultiplied =
      (1 - sourceAlpha) * backdropAlpha * backdropColor[component]!
      + (1 - backdropAlpha) * sourceAlpha * sourceColor[component]!
      + sourceAlpha * backdropAlpha * blended[component]!
    output[component] = clamp01(premultiplied / outputAlpha)
  }
  return output
}

export function blendPdfColor(backdrop: [number, number, number], source: [number, number, number], mode: BlendMode): [number, number, number] {
  if (mode === 'hue') return setLuminosity(setSaturation(source, saturation(backdrop)), luminosity(backdrop))
  if (mode === 'saturation') return setLuminosity(setSaturation(backdrop, saturation(source)), luminosity(backdrop))
  if (mode === 'color') return setLuminosity(source, luminosity(backdrop))
  if (mode === 'luminosity') return setLuminosity(backdrop, luminosity(source))
  return [
    blendComponent(backdrop[0], source[0], mode),
    blendComponent(backdrop[1], source[1], mode),
    blendComponent(backdrop[2], source[2], mode),
  ]
}

function blendComponent(backdrop: number, source: number, mode: BlendMode): number {
  if (mode === 'normal') return source
  if (mode === 'multiply') return backdrop * source
  if (mode === 'screen') return backdrop + source - backdrop * source
  if (mode === 'overlay') return hardLight(source, backdrop)
  if (mode === 'darken') return Math.min(backdrop, source)
  if (mode === 'lighten') return Math.max(backdrop, source)
  if (mode === 'color-dodge') return source === 1 ? 1 : Math.min(1, backdrop / (1 - source))
  if (mode === 'color-burn') return source === 0 ? 0 : 1 - Math.min(1, (1 - backdrop) / source)
  if (mode === 'hard-light') return hardLight(backdrop, source)
  if (mode === 'soft-light') {
    if (source <= 0.5) return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop)
    const d = backdrop <= 0.25 ? ((16 * backdrop - 12) * backdrop + 4) * backdrop : Math.sqrt(backdrop)
    return backdrop + (2 * source - 1) * (d - backdrop)
  }
  if (mode === 'difference') return Math.abs(backdrop - source)
  if (mode === 'exclusion') return backdrop + source - 2 * backdrop * source
  throw new Error(`Unsupported PDF blend mode: ${mode}`)
}

function hardLight(backdrop: number, source: number): number {
  return source <= 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source)
}

function luminosity(color: [number, number, number]): number {
  return 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2]
}

function saturation(color: [number, number, number]): number {
  return Math.max(color[0], color[1], color[2]) - Math.min(color[0], color[1], color[2])
}

function setLuminosity(color: [number, number, number], value: number): [number, number, number] {
  const difference = value - luminosity(color)
  return clipColor([color[0] + difference, color[1] + difference, color[2] + difference])
}

function setSaturation(color: [number, number, number], value: number): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0]
  const indices = [0, 1, 2]
  indices.sort(function (left, right) { return color[left]! - color[right]! })
  const minimum = indices[0]!
  const middle = indices[1]!
  const maximum = indices[2]!
  if (color[maximum]! > color[minimum]!) {
    result[middle] = (color[middle]! - color[minimum]!) * value / (color[maximum]! - color[minimum]!)
    result[maximum] = value
  }
  return result
}

function clipColor(color: [number, number, number]): [number, number, number] {
  const value = luminosity(color)
  const minimum = Math.min(color[0], color[1], color[2])
  const maximum = Math.max(color[0], color[1], color[2])
  if (minimum < 0) {
    for (let component = 0; component < 3; component++) color[component] = value + (color[component]! - value) * value / (value - minimum)
  }
  if (maximum > 1) {
    for (let component = 0; component < 3; component++) color[component] = value + (color[component]! - value) * (1 - value) / (maximum - value)
  }
  return color
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
