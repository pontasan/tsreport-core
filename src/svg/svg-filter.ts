import type { SvgFilterGraph, SvgFilterPrimitive } from './svg-types.js'
import { decodePng } from '../image/png-parser.js'
import { decodeJpegToRgba } from '../image/jpeg-decoder.js'
import type { Font } from '../font.js'
import { parseCssColor } from './svg-parser.js'

export interface SvgFilterRaster {
  width: number
  height: number
  data: Float32Array
  region: SvgFilterRegion
}

export interface SvgFilterRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface SvgFilterExecutionGeometry {
  /** Maps primitiveUnits coordinates to filter-raster pixel coordinates. */
  primitiveTransform?: [number, number, number, number, number, number]
  /** Percentage reference dimensions in primitiveUnits coordinates. */
  percentageReferenceWidth?: number
  percentageReferenceHeight?: number
}

export interface SvgFilterStandardInputs {
  background?: Uint8ClampedArray
  fillPaint?: Uint8ClampedArray
  strokePaint?: Uint8ClampedArray
  imageReferences?: ReadonlyMap<string, Uint8ClampedArray>
  imageResources?: ReadonlyMap<string, { data: Uint8Array, mimeType: string }>
}

export function executeSvgFilterGraph(
  filter: SvgFilterGraph,
  sourceRgba: Uint8ClampedArray,
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
  paletteFont?: Font,
  geometry?: SvgFilterExecutionGeometry,
  standardInputs?: SvgFilterStandardInputs,
): Uint8Array {
  const source = rasterFromBytes(sourceRgba, width, height)
  const transparent = createRaster(width, height)
  const inputs = new Map<string, SvgFilterRaster>()
  inputs.set('SourceGraphic', source)
  inputs.set('SourceAlpha', extractAlpha(source))
  const background = standardInputs?.background ? rasterFromBytes(standardInputs.background, width, height) : transparent
  inputs.set('BackgroundImage', background)
  inputs.set('BackgroundAlpha', standardInputs?.background ? extractAlpha(background) : transparent)
  inputs.set('FillPaint', standardInputs?.fillPaint ? rasterFromBytes(standardInputs.fillPaint, width, height) : transparent)
  inputs.set('StrokePaint', standardInputs?.strokePaint ? rasterFromBytes(standardInputs.strokePaint, width, height) : transparent)
  if (standardInputs?.imageReferences !== undefined) {
    for (const [href, pixels] of standardInputs.imageReferences) {
      inputs.set(`feImage:${href}`, rasterFromBytes(pixels, width, height))
    }
  }

  let previous = source
  for (let i = 0; i < filter.primitives.length; i++) {
    const primitive = filter.primitives[i]!
    const first = resolveInput(primitive.attributes.in, previous, inputs, i === 0 ? source : undefined)
    const region = resolvePrimitiveRegion(primitive, first, previous, inputs, width, height, scaleX, scaleY, geometry)
    const colorSpace = primitive.attributes['color-interpolation-filters']
      ?? filter.attributes['color-interpolation-filters']
      ?? 'linearRGB'
    const workingInputs = colorSpace === 'sRGB' ? convertReferencedInputMap(primitive, inputs, 'sRGB') : inputs
    const workingPrevious = colorSpace === 'sRGB' ? convertRasterColorSpace(previous, 'sRGB') : previous
    const workingFirst = colorSpace === 'sRGB' ? convertRasterColorSpace(first, 'sRGB') : first
    const clippedFirst = clipRaster(workingFirst, region)
    let result = executePrimitive(
      primitive,
      clippedFirst,
      workingPrevious,
      workingInputs,
      width,
      height,
      scaleX,
      scaleY,
      region,
      colorSpace === 'sRGB' ? 'sRGB' : 'linearRGB',
      geometry?.primitiveTransform,
      paletteFont,
      standardInputs?.imageResources,
    )
    result = clipRaster(result, region)
    result.region = region
    if (colorSpace === 'sRGB') result = convertRasterColorSpace(result, 'linearRGB')
    previous = result
    const name = primitive.attributes.result
    if (name) inputs.set(name, result)
  }
  return rasterToBytes(previous)
}

function executePrimitive(
  primitive: SvgFilterPrimitive,
  first: SvgFilterRaster,
  previous: SvgFilterRaster,
  inputs: Map<string, SvgFilterRaster>,
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
  region: SvgFilterRegion,
  colorSpace: 'linearRGB' | 'sRGB',
  primitiveTransform?: [number, number, number, number, number, number],
  paletteFont?: Font,
  imageResources?: ReadonlyMap<string, { data: Uint8Array, mimeType: string }>,
): SvgFilterRaster {
  const a = primitive.attributes
  switch (primitive.type) {
    case 'feBlend':
      return blendRasters(first, clipRaster(resolveRequiredInput(a.in2, previous, inputs), region), a.mode ?? 'normal')
    case 'feColorMatrix':
      return colorMatrix(first, a.type ?? 'matrix', parseNumbers(a.values))
    case 'feComponentTransfer':
      return componentTransfer(first, primitive.children)
    case 'feComposite':
      return compositeRasters(first, clipRaster(resolveRequiredInput(a.in2, previous, inputs), region), a.operator ?? 'over', number(a.k1, 0), number(a.k2, 0), number(a.k3, 0), number(a.k4, 0))
    case 'feConvolveMatrix':
      return convolveMatrix(first, primitive, Math.abs(scaleX), Math.abs(scaleY), primitiveTransform)
    case 'feDiffuseLighting':
      return lighting(first, primitive, false, colorSpace, primitiveTransform, paletteFont)
    case 'feDisplacementMap':
      return displacementMap(first, clipRaster(resolveRequiredInput(a.in2, previous, inputs), region), number(a.scale, 0), a.xChannelSelector ?? 'A', a.yChannelSelector ?? 'A', primitiveTransform, scaleX, scaleY)
    case 'feFlood':
      return flood(width, height, a['flood-color'] ?? '#000000', number(a['flood-opacity'], 1), colorSpace, paletteFont)
    case 'feGaussianBlur': {
      const deviation = parsePair(a.stdDeviation, 0)
      return gaussianBlurTransformed(first, Math.max(0, deviation.x), Math.max(0, deviation.y), primitiveTransform, scaleX, scaleY)
    }
    case 'feImage':
      return imageRaster(
        a.href ?? a['xlink:href'] ?? '', width, height, region,
        a.preserveAspectRatio ?? 'xMidYMid meet', colorSpace,
        inputs.get(`feImage:${a.href ?? a['xlink:href'] ?? ''}`),
        imageResources,
      )
    case 'feMerge':
      return mergeRasters(primitive.children, previous, inputs, width, height)
    case 'feMorphology': {
      const radius = parsePair(a.radius, 0)
      return morphology(first, a.operator ?? 'erode', Math.max(0, radius.x), Math.max(0, radius.y), primitiveTransform, scaleX, scaleY)
    }
    case 'feOffset': {
      const offset = transformFilterVector(number(a.dx, 0), number(a.dy, 0), primitiveTransform, scaleX, scaleY)
      return offsetRaster(first, offset.x, offset.y)
    }
    case 'feSpecularLighting':
      return lighting(first, primitive, true, colorSpace, primitiveTransform, paletteFont)
    case 'feTile':
      return tileRaster(resolveInput(a.in, previous, inputs), region)
    case 'feTurbulence':
      return turbulence(width, height, primitive, region, primitiveTransform)
    case 'feDropShadow': {
      const deviation = parsePair(a.stdDeviation, 2)
      const offset = transformFilterVector(number(a.dx, 2), number(a.dy, 2), primitiveTransform, scaleX, scaleY)
      const shadow = offsetRaster(
        gaussianBlurTransformed(extractAlpha(first), deviation.x, deviation.y, primitiveTransform, scaleX, scaleY),
        offset.x,
        offset.y,
      )
      const colored = colorizeAlpha(shadow, a['flood-color'] ?? '#000000', number(a['flood-opacity'], 1), colorSpace, paletteFont)
      return compositeRasters(first, colored, 'over', 0, 0, 0, 0)
    }
    default:
      throw new Error(`SVG filter primitive <${primitive.type}> is not defined by SVG 1.1`)
  }
}

function createRaster(width: number, height: number): SvgFilterRaster {
  return { width, height, data: new Float32Array(width * height * 4), region: { x: 0, y: 0, width, height } }
}

function rasterFromBytes(bytes: Uint8ClampedArray | Uint8Array, width: number, height: number): SvgFilterRaster {
  const out = createRaster(width, height)
  for (let i = 0; i < width * height; i++) {
    const p = i * 4
    const alpha = bytes[p + 3]! / 255
    out.data[p] = srgbToLinear(bytes[p]! / 255) * alpha
    out.data[p + 1] = srgbToLinear(bytes[p + 1]! / 255) * alpha
    out.data[p + 2] = srgbToLinear(bytes[p + 2]! / 255) * alpha
    out.data[p + 3] = alpha
  }
  return out
}

function rasterToBytes(raster: SvgFilterRaster): Uint8Array {
  const out = new Uint8Array(raster.width * raster.height * 4)
  for (let i = 0; i < raster.width * raster.height; i++) {
    const p = i * 4
    const alpha = clamp(raster.data[p + 3]!)
    if (alpha > 1e-9) {
      out[p] = Math.round(linearToSrgb(clamp(raster.data[p]! / alpha)) * 255)
      out[p + 1] = Math.round(linearToSrgb(clamp(raster.data[p + 1]! / alpha)) * 255)
      out[p + 2] = Math.round(linearToSrgb(clamp(raster.data[p + 2]! / alpha)) * 255)
    }
    out[p + 3] = Math.round(alpha * 255)
  }
  return out
}

function resolveInput(
  name: string | undefined,
  previous: SvgFilterRaster,
  inputs: Map<string, SvgFilterRaster>,
  firstDefault?: SvgFilterRaster,
): SvgFilterRaster {
  if (!name) return firstDefault ?? previous
  const input = inputs.get(name)
  if (!input) throw new Error(`SVG filter input "${name}" does not reference a preceding result`)
  return input
}

function resolveRequiredInput(name: string | undefined, previous: SvgFilterRaster, inputs: Map<string, SvgFilterRaster>): SvgFilterRaster {
  if (!name) throw new Error('SVG filter primitive requires an in2 attribute')
  return resolveInput(name, previous, inputs)
}

const STANDARD_FILTER_INPUTS = new Set([
  'SourceGraphic',
  'SourceAlpha',
  'BackgroundImage',
  'BackgroundAlpha',
  'FillPaint',
  'StrokePaint',
])

function resolvePrimitiveRegion(
  primitive: SvgFilterPrimitive,
  first: SvgFilterRaster,
  previous: SvgFilterRaster,
  inputs: Map<string, SvgFilterRaster>,
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
  geometry: SvgFilterExecutionGeometry | undefined,
): SvgFilterRegion {
  const referenced = collectPrimitiveInputs(primitive, first, previous, inputs)
  let region: SvgFilterRegion
  if (primitive.type === 'feTile' || referenced.length === 0 || hasStandardInputReference(primitive, referenced, inputs)) {
    region = { x: 0, y: 0, width, height }
  } else {
    region = referenced[0]!.region
    for (let i = 1; i < referenced.length; i++) region = unionRegions(region, referenced[i]!.region)
  }

  const a = primitive.attributes
  if (a.x === undefined && a.y === undefined && a.width === undefined && a.height === undefined) return intersectRegion(region, { x: 0, y: 0, width, height })

  const transform = geometry?.primitiveTransform ?? [scaleX, 0, 0, scaleY, 0, 0]
  const referenceWidth = geometry?.percentageReferenceWidth ?? width / Math.max(Math.abs(scaleX), 1e-9)
  const referenceHeight = geometry?.percentageReferenceHeight ?? height / Math.max(Math.abs(scaleY), 1e-9)
  const defaultPrimitive = inverseTransformRegion(region, transform)
  const x = parsePrimitiveLength(a.x, referenceWidth, defaultPrimitive.x)
  const y = parsePrimitiveLength(a.y, referenceHeight, defaultPrimitive.y)
  const primitiveWidth = parsePrimitiveLength(a.width, referenceWidth, defaultPrimitive.width)
  const primitiveHeight = parsePrimitiveLength(a.height, referenceHeight, defaultPrimitive.height)
  if (primitiveWidth < 0 || primitiveHeight < 0) throw new Error(`SVG filter primitive <${primitive.type}> has a negative subregion size`)
  if (primitiveWidth === 0 || primitiveHeight === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const transformed = transformRegion({ x, y, width: primitiveWidth, height: primitiveHeight }, transform)
  return intersectRegion(transformed, { x: 0, y: 0, width, height })
}

function collectPrimitiveInputs(
  primitive: SvgFilterPrimitive,
  first: SvgFilterRaster,
  previous: SvgFilterRaster,
  inputs: Map<string, SvgFilterRaster>,
): SvgFilterRaster[] {
  if (primitive.type === 'feFlood' || primitive.type === 'feImage' || primitive.type === 'feTurbulence') return []
  if (primitive.type === 'feMerge') {
    const out = new Array<SvgFilterRaster>(primitive.children.length)
    for (let i = 0; i < primitive.children.length; i++) out[i] = resolveInput(primitive.children[i]!.attributes.in, previous, inputs)
    return out
  }
  if (primitive.type === 'feBlend' || primitive.type === 'feComposite' || primitive.type === 'feDisplacementMap') {
    return [first, resolveRequiredInput(primitive.attributes.in2, previous, inputs)]
  }
  return [first]
}

function hasStandardInputReference(
  primitive: SvgFilterPrimitive,
  referenced: SvgFilterRaster[],
  inputs: Map<string, SvgFilterRaster>,
): boolean {
  const firstName = primitive.attributes.in
  if (firstName && STANDARD_FILTER_INPUTS.has(firstName)) return true
  if (primitive.type === 'feMerge') {
    for (let i = 0; i < primitive.children.length; i++) {
      const name = primitive.children[i]!.attributes.in
      if (name && STANDARD_FILTER_INPUTS.has(name)) return true
    }
  }
  const secondName = primitive.attributes.in2
  if (secondName && STANDARD_FILTER_INPUTS.has(secondName)) return true
  for (let i = 0; i < referenced.length; i++) {
    for (const standardName of STANDARD_FILTER_INPUTS) {
      if (referenced[i] === inputs.get(standardName)) return true
    }
  }
  return false
}

function parsePrimitiveLength(value: string | undefined, percentageReference: number, fallback: number): number {
  if (value === undefined) return fallback
  const trimmed = value.trim()
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid SVG filter primitive length "${value}"`)
  return trimmed.endsWith('%') ? parsed * percentageReference / 100 : parsed
}

function transformRegion(region: SvgFilterRegion, matrix: [number, number, number, number, number, number]): SvgFilterRegion {
  const x0 = matrix[0] * region.x + matrix[2] * region.y + matrix[4]
  const y0 = matrix[1] * region.x + matrix[3] * region.y + matrix[5]
  const x1 = matrix[0] * (region.x + region.width) + matrix[2] * region.y + matrix[4]
  const y1 = matrix[1] * (region.x + region.width) + matrix[3] * region.y + matrix[5]
  const x2 = matrix[0] * region.x + matrix[2] * (region.y + region.height) + matrix[4]
  const y2 = matrix[1] * region.x + matrix[3] * (region.y + region.height) + matrix[5]
  const x3 = matrix[0] * (region.x + region.width) + matrix[2] * (region.y + region.height) + matrix[4]
  const y3 = matrix[1] * (region.x + region.width) + matrix[3] * (region.y + region.height) + matrix[5]
  const minX = Math.min(x0, x1, x2, x3)
  const minY = Math.min(y0, y1, y2, y3)
  const maxX = Math.max(x0, x1, x2, x3)
  const maxY = Math.max(y0, y1, y2, y3)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function inverseTransformRegion(region: SvgFilterRegion, matrix: [number, number, number, number, number, number]): SvgFilterRegion {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
  if (Math.abs(determinant) < 1e-12) return { x: 0, y: 0, width: 0, height: 0 }
  const inverse: [number, number, number, number, number, number] = [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
  ]
  return transformRegion(region, inverse)
}

function unionRegions(a: SvgFilterRegion, b: SvgFilterRegion): SvgFilterRegion {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.width, b.x + b.width)
  const maxY = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: maxX - x, height: maxY - y }
}

function intersectRegion(a: SvgFilterRegion, b: SvgFilterRegion): SvgFilterRegion {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const maxX = Math.min(a.x + a.width, b.x + b.width)
  const maxY = Math.min(a.y + a.height, b.y + b.height)
  return { x, y, width: Math.max(0, maxX - x), height: Math.max(0, maxY - y) }
}

function integerRegion(region: SvgFilterRegion, width: number, height: number): { x: number, y: number, width: number, height: number } {
  const x = Math.max(0, Math.floor(region.x))
  const y = Math.max(0, Math.floor(region.y))
  const maxX = Math.min(width, Math.ceil(region.x + region.width))
  const maxY = Math.min(height, Math.ceil(region.y + region.height))
  return { x, y, width: Math.max(0, maxX - x), height: Math.max(0, maxY - y) }
}

function clipRaster(source: SvgFilterRaster, region: SvgFilterRegion): SvgFilterRaster {
  const clipped = intersectRegion(source.region, region)
  const out = createRaster(source.width, source.height)
  out.region = clipped
  const pixels = integerRegion(clipped, source.width, source.height)
  for (let y = pixels.y; y < pixels.y + pixels.height; y++) {
    const start = (y * source.width + pixels.x) * 4
    const end = start + pixels.width * 4
    out.data.set(source.data.subarray(start, end), start)
  }
  return out
}

function convertReferencedInputMap(
  primitive: SvgFilterPrimitive,
  inputs: Map<string, SvgFilterRaster>,
  target: 'linearRGB' | 'sRGB',
): Map<string, SvgFilterRaster> {
  const converted = new Map(inputs)
  convertNamedInput(primitive.attributes.in, converted, target)
  convertNamedInput(primitive.attributes.in2, converted, target)
  if (primitive.type === 'feImage') {
    convertNamedInput(`feImage:${primitive.attributes.href ?? primitive.attributes['xlink:href'] ?? ''}`, converted, target)
  }
  if (primitive.type === 'feMerge') {
    for (let i = 0; i < primitive.children.length; i++) convertNamedInput(primitive.children[i]!.attributes.in, converted, target)
  }
  return converted
}

function convertNamedInput(name: string | undefined, inputs: Map<string, SvgFilterRaster>, target: 'linearRGB' | 'sRGB'): void {
  if (!name) return
  const raster = inputs.get(name)
  if (raster) inputs.set(name, convertRasterColorSpace(raster, target))
}

function convertRasterColorSpace(source: SvgFilterRaster, target: 'linearRGB' | 'sRGB'): SvgFilterRaster {
  const out = createRaster(source.width, source.height)
  out.region = source.region
  const pixels = integerRegion(source.region, source.width, source.height)
  for (let y = pixels.y; y < pixels.y + pixels.height; y++) for (let x = pixels.x; x < pixels.x + pixels.width; x++) {
    const p = (y * source.width + x) * 4
    const alpha = source.data[p + 3]!
    out.data[p + 3] = alpha
    if (alpha <= 1e-9) continue
    for (let c = 0; c < 3; c++) {
      const channel = clamp(source.data[p + c]! / alpha)
      out.data[p + c] = (target === 'sRGB' ? linearToSrgb(channel) : srgbToLinear(channel)) * alpha
    }
  }
  return out
}

function extractAlpha(source: SvgFilterRaster): SvgFilterRaster {
  const out = createRaster(source.width, source.height)
  for (let i = 0; i < source.width * source.height; i++) out.data[i * 4 + 3] = source.data[i * 4 + 3]!
  return out
}

function flood(width: number, height: number, value: string, opacity: number, colorSpace: 'linearRGB' | 'sRGB', paletteFont?: Font): SvgFilterRaster {
  const resolved = resolvePaletteColorValue(value, paletteFont)
  const color = workingColor(resolved.color, colorSpace)
  const alpha = clamp(opacity * color.a * resolved.paletteAlpha)
  const out = createRaster(width, height)
  for (let i = 0; i < width * height; i++) {
    const p = i * 4
    out.data[p] = color.r * alpha
    out.data[p + 1] = color.g * alpha
    out.data[p + 2] = color.b * alpha
    out.data[p + 3] = alpha
  }
  return out
}

function colorizeAlpha(source: SvgFilterRaster, value: string, opacity: number, colorSpace: 'linearRGB' | 'sRGB', paletteFont?: Font): SvgFilterRaster {
  const resolved = resolvePaletteColorValue(value, paletteFont)
  const color = workingColor(resolved.color, colorSpace)
  const out = createRaster(source.width, source.height)
  for (let i = 0; i < source.width * source.height; i++) {
    const p = i * 4
    const alpha = clamp(source.data[p + 3]! * opacity * color.a * resolved.paletteAlpha)
    out.data[p] = color.r * alpha
    out.data[p + 1] = color.g * alpha
    out.data[p + 2] = color.b * alpha
    out.data[p + 3] = alpha
  }
  return out
}

function blendRasters(a: SvgFilterRaster, b: SvgFilterRaster, mode: string): SvgFilterRaster {
  const out = createRaster(a.width, a.height)
  for (let i = 0; i < a.width * a.height; i++) {
    const p = i * 4
    const aa = a.data[p + 3]!
    const ba = b.data[p + 3]!
    for (let c = 0; c < 3; c++) {
      const ac = aa > 1e-9 ? a.data[p + c]! / aa : 0
      const bc = ba > 1e-9 ? b.data[p + c]! / ba : 0
      const blended = blendChannel(ac, bc, mode)
      out.data[p + c] = (1 - ba) * a.data[p + c]! + (1 - aa) * b.data[p + c]! + aa * ba * blended
    }
    out.data[p + 3] = aa + ba - aa * ba
  }
  return out
}

function blendChannel(a: number, b: number, mode: string): number {
  switch (mode) {
    case 'multiply': return a * b
    case 'screen': return a + b - a * b
    case 'darken': return Math.min(a, b)
    case 'lighten': return Math.max(a, b)
    default: return a
  }
}

function compositeRasters(a: SvgFilterRaster, b: SvgFilterRaster, operator: string, k1: number, k2: number, k3: number, k4: number): SvgFilterRaster {
  const out = createRaster(a.width, a.height)
  for (let i = 0; i < a.width * a.height; i++) {
    const p = i * 4
    const aa = a.data[p + 3]!
    const ba = b.data[p + 3]!
    if (operator === 'arithmetic') {
      for (let c = 0; c < 4; c++) out.data[p + c] = clamp(k1 * a.data[p + c]! * b.data[p + c]! + k2 * a.data[p + c]! + k3 * b.data[p + c]! + k4)
      continue
    }
    let fa = 1
    let fb = 1 - aa
    if (operator === 'in') { fa = ba; fb = 0 }
    else if (operator === 'out') { fa = 1 - ba; fb = 0 }
    else if (operator === 'atop') { fa = ba; fb = 1 - aa }
    else if (operator === 'xor') { fa = 1 - ba; fb = 1 - aa }
    for (let c = 0; c < 4; c++) out.data[p + c] = clamp(a.data[p + c]! * fa + b.data[p + c]! * fb)
  }
  return out
}

function colorMatrix(source: SvgFilterRaster, type: string, values: number[]): SvgFilterRaster {
  let matrix: number[]
  if (type === 'saturate') {
    const s = values[0] ?? 1
    matrix = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0, 0, 0, 0, 1, 0]
  } else if (type === 'hueRotate') {
    const angle = (values[0] ?? 0) * Math.PI / 180
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    matrix = [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0, 0, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0, 0, 0, 0, 1, 0]
  } else if (type === 'luminanceToAlpha') {
    matrix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2125, 0.7154, 0.0721, 0, 0]
  } else {
    matrix = values.length === 20 ? values : [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]
  }
  const out = createRaster(source.width, source.height)
  for (let i = 0; i < source.width * source.height; i++) {
    const p = i * 4
    const alpha = source.data[p + 3]!
    const r = alpha > 1e-9 ? source.data[p]! / alpha : 0
    const g = alpha > 1e-9 ? source.data[p + 1]! / alpha : 0
    const b = alpha > 1e-9 ? source.data[p + 2]! / alpha : 0
    const na = clamp(matrix[15]! * r + matrix[16]! * g + matrix[17]! * b + matrix[18]! * alpha + matrix[19]!)
    out.data[p] = clamp(matrix[0]! * r + matrix[1]! * g + matrix[2]! * b + matrix[3]! * alpha + matrix[4]!) * na
    out.data[p + 1] = clamp(matrix[5]! * r + matrix[6]! * g + matrix[7]! * b + matrix[8]! * alpha + matrix[9]!) * na
    out.data[p + 2] = clamp(matrix[10]! * r + matrix[11]! * g + matrix[12]! * b + matrix[13]! * alpha + matrix[14]!) * na
    out.data[p + 3] = na
  }
  return out
}

function componentTransfer(source: SvgFilterRaster, functions: SvgFilterPrimitive[]): SvgFilterRaster {
  const byChannel = new Map<string, SvgFilterPrimitive>()
  for (let i = 0; i < functions.length; i++) byChannel.set(functions[i]!.type, functions[i]!)
  const out = createRaster(source.width, source.height)
  for (let i = 0; i < source.width * source.height; i++) {
    const p = i * 4
    const alpha = source.data[p + 3]!
    const values = [alpha > 1e-9 ? source.data[p]! / alpha : 0, alpha > 1e-9 ? source.data[p + 1]! / alpha : 0, alpha > 1e-9 ? source.data[p + 2]! / alpha : 0, alpha]
    values[0] = transferValue(values[0]!, byChannel.get('feFuncR'))
    values[1] = transferValue(values[1]!, byChannel.get('feFuncG'))
    values[2] = transferValue(values[2]!, byChannel.get('feFuncB'))
    values[3] = transferValue(values[3]!, byChannel.get('feFuncA'))
    out.data[p] = values[0]! * values[3]!
    out.data[p + 1] = values[1]! * values[3]!
    out.data[p + 2] = values[2]! * values[3]!
    out.data[p + 3] = values[3]!
  }
  return out
}

function transferValue(value: number, fn: SvgFilterPrimitive | undefined): number {
  if (!fn || (fn.attributes.type ?? 'identity') === 'identity') return value
  const a = fn.attributes
  if (a.type === 'linear') return clamp(number(a.slope, 1) * value + number(a.intercept, 0))
  if (a.type === 'gamma') return clamp(number(a.amplitude, 1) * Math.pow(value, number(a.exponent, 1)) + number(a.offset, 0))
  const table = parseNumbers(a.tableValues)
  if (table.length === 0) return value
  if (a.type === 'discrete') return clamp(table[Math.min(table.length - 1, Math.floor(value * table.length))]!)
  const position = value * (table.length - 1)
  const low = Math.floor(position)
  const high = Math.min(table.length - 1, low + 1)
  const t = position - low
  return clamp(table[low]! * (1 - t) + table[high]! * t)
}

function gaussianBlur(source: SvgFilterRaster, sigmaX: number, sigmaY: number): SvgFilterRaster {
  let data = source.data
  if (sigmaX > 1e-3) data = convolveAxis(data, source.width, source.height, gaussianKernel(sigmaX), true)
  if (sigmaY > 1e-3) data = convolveAxis(data, source.width, source.height, gaussianKernel(sigmaY), false)
  return { width: source.width, height: source.height, data, region: source.region }
}

function gaussianBlurTransformed(
  source: SvgFilterRaster,
  sigmaX: number,
  sigmaY: number,
  transform: [number, number, number, number, number, number] | undefined,
  scaleX: number,
  scaleY: number,
): SvgFilterRaster {
  const a = transform?.[0] ?? scaleX
  const b = transform?.[1] ?? 0
  const c = transform?.[2] ?? 0
  const d = transform?.[3] ?? scaleY
  if (sigmaX <= 1e-12 && sigmaY <= 1e-12) return { ...source, data: source.data.slice() }
  if (sigmaX <= 1e-12) return convolveGaussianVector(source, c, d, sigmaY)
  if (sigmaY <= 1e-12) return convolveGaussianVector(source, a, b, sigmaX)
  if (Math.abs(b) <= 1e-12 && Math.abs(c) <= 1e-12) {
    return gaussianBlur(source, sigmaX * Math.abs(a), sigmaY * Math.abs(d))
  }
  const varianceX = sigmaX * sigmaX
  const varianceY = sigmaY * sigmaY
  const covarianceXX = a * a * varianceX + c * c * varianceY
  const covarianceXY = a * b * varianceX + c * d * varianceY
  const covarianceYY = b * b * varianceX + d * d * varianceY
  if (covarianceXX <= 1e-12 && covarianceYY <= 1e-12) return { ...source, data: source.data.slice() }
  const determinant = covarianceXX * covarianceYY - covarianceXY * covarianceXY
  if (determinant <= 1e-18) throw new Error('SVG filter primitive coordinate system is singular')
  const inverseXX = covarianceYY / determinant
  const inverseXY = -covarianceXY / determinant
  const inverseYY = covarianceXX / determinant
  const radiusX = Math.max(1, Math.ceil(3 * Math.sqrt(covarianceXX)))
  const radiusY = Math.max(1, Math.ceil(3 * Math.sqrt(covarianceYY)))
  const kernelWidth = radiusX * 2 + 1
  const kernel = new Float32Array(kernelWidth * (radiusY * 2 + 1))
  let total = 0
  for (let y = -radiusY; y <= radiusY; y++) for (let x = -radiusX; x <= radiusX; x++) {
    const exponent = -0.5 * (inverseXX * x * x + 2 * inverseXY * x * y + inverseYY * y * y)
    const weight = exponent < -4.5 ? 0 : Math.exp(exponent)
    kernel[(y + radiusY) * kernelWidth + x + radiusX] = weight
    total += weight
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] = kernel[i]! / total
  const out = createRaster(source.width, source.height)
  out.region = source.region
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const target = (y * source.width + x) * 4
    for (let ky = -radiusY; ky <= radiusY; ky++) for (let kx = -radiusX; kx <= radiusX; kx++) {
      const weight = kernel[(ky + radiusY) * kernelWidth + kx + radiusX]!
      if (weight === 0) continue
      const sourceOffset = ((y + ky) * source.width + x + kx) * 4
      if (x + kx < 0 || y + ky < 0 || x + kx >= source.width || y + ky >= source.height) continue
      for (let channel = 0; channel < 4; channel++) out.data[target + channel] = out.data[target + channel]! + source.data[sourceOffset + channel]! * weight
    }
  }
  return out
}

function convolveGaussianVector(source: SvgFilterRaster, vectorX: number, vectorY: number, sigma: number): SvgFilterRaster {
  const length = Math.hypot(vectorX, vectorY)
  if (length <= 1e-12 || sigma <= 1e-12) return { ...source, data: source.data.slice() }
  const unitX = vectorX / length
  const unitY = vectorY / length
  const deviceSigma = sigma * length
  const kernel = gaussianKernel(deviceSigma)
  const radius = kernel.length >> 1
  const out = createRaster(source.width, source.height)
  out.region = source.region
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const target = (y * source.width + x) * 4
    for (let k = -radius; k <= radius; k++) {
      const sampleX = x + unitX * k
      const sampleY = y + unitY * k
      const x0 = Math.floor(sampleX)
      const y0 = Math.floor(sampleY)
      const weight = kernel[k + radius]!
      for (let channel = 0; channel < 4; channel++) {
        out.data[target + channel] = out.data[target + channel]! + bilinear(source, x0, y0, sampleX - x0, sampleY - y0, channel) * weight
      }
    }
  }
  return out
}

function transformFilterVector(
  x: number,
  y: number,
  transform: [number, number, number, number, number, number] | undefined,
  scaleX: number,
  scaleY: number,
): { x: number, y: number } {
  return transform
    ? { x: transform[0] * x + transform[2] * y, y: transform[1] * x + transform[3] * y }
    : { x: scaleX * x, y: scaleY * y }
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const out = new Float32Array(radius * 2 + 1)
  let total = 0
  for (let i = -radius; i <= radius; i++) { const value = Math.exp(-(i * i) / (2 * sigma * sigma)); out[i + radius] = value; total += value }
  for (let i = 0; i < out.length; i++) out[i]! /= total
  return out
}

function convolveAxis(source: Float32Array, width: number, height: number, kernel: Float32Array, horizontal: boolean): Float32Array {
  const out = new Float32Array(source.length)
  const radius = kernel.length >> 1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let k = -radius; k <= radius; k++) {
    const sx = horizontal ? x + k : x
    const sy = horizontal ? y : y + k
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue
    const sourceOffset = (sy * width + sx) * 4
    const targetOffset = (y * width + x) * 4
    const weight = kernel[k + radius]!
    for (let c = 0; c < 4; c++) out[targetOffset + c]! += source[sourceOffset + c]! * weight
  }
  return out
}

function offsetRaster(source: SvgFilterRaster, dx: number, dy: number): SvgFilterRaster {
  const out = createRaster(source.width, source.height)
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const sx = x - dx
    const sy = y - dy
    const x0 = Math.floor(sx)
    const y0 = Math.floor(sy)
    const tx = sx - x0
    const ty = sy - y0
    const p = (y * source.width + x) * 4
    for (let c = 0; c < 4; c++) out.data[p + c] = bilinear(source, x0, y0, tx, ty, c)
  }
  return out
}

function bilinear(source: SvgFilterRaster, x: number, y: number, tx: number, ty: number, channel: number): number {
  return sample(source, x, y, channel) * (1 - tx) * (1 - ty) + sample(source, x + 1, y, channel) * tx * (1 - ty) + sample(source, x, y + 1, channel) * (1 - tx) * ty + sample(source, x + 1, y + 1, channel) * tx * ty
}

function sample(source: SvgFilterRaster, x: number, y: number, channel: number): number {
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) return 0
  return source.data[(y * source.width + x) * 4 + channel]!
}

function mergeRasters(nodes: SvgFilterPrimitive[], previous: SvgFilterRaster, inputs: Map<string, SvgFilterRaster>, width: number, height: number): SvgFilterRaster {
  let out = createRaster(width, height)
  for (let i = 0; i < nodes.length; i++) out = compositeRasters(resolveInput(nodes[i]!.attributes.in, previous, inputs), out, 'over', 0, 0, 0, 0)
  return out
}

function morphology(
  source: SvgFilterRaster,
  operator: string,
  radiusX: number,
  radiusY: number,
  transform: [number, number, number, number, number, number] | undefined,
  scaleX: number,
  scaleY: number,
): SvgFilterRaster {
  if (radiusX <= 1e-12 && radiusY <= 1e-12) return { ...source, data: source.data.slice() }
  const out = createRaster(source.width, source.height)
  const erode = operator !== 'dilate'
  const xVector = transformFilterVector(radiusX, 0, transform, scaleX, scaleY)
  const yVector = transformFilterVector(0, radiusY, transform, scaleX, scaleY)
  const extentX = Math.ceil(Math.abs(xVector.x) + Math.abs(yVector.x))
  const extentY = Math.ceil(Math.abs(xVector.y) + Math.abs(yVector.y))
  const linear = transform ?? [scaleX, 0, 0, scaleY, 0, 0]
  const determinant = linear[0] * linear[3] - linear[1] * linear[2]
  if (Math.abs(determinant) <= 1e-12 && (radiusX > 0 || radiusY > 0)) throw new Error('SVG feMorphology primitive coordinate system is singular')
  const inverseA = linear[3] / determinant
  const inverseB = -linear[1] / determinant
  const inverseC = -linear[2] / determinant
  const inverseD = linear[0] / determinant
  const offsets: Array<{ x: number, y: number }> = []
  for (let y = -extentY; y <= extentY; y++) for (let x = -extentX; x <= extentX; x++) {
    const primitiveX = inverseA * x + inverseC * y
    const primitiveY = inverseB * x + inverseD * y
    if (Math.abs(primitiveX) <= radiusX + 1e-9 && Math.abs(primitiveY) <= radiusY + 1e-9) offsets.push({ x, y })
  }
  if (offsets.length === 0) offsets.push({ x: 0, y: 0 })
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) for (let c = 0; c < 4; c++) {
    let value = erode ? 1 : 0
    for (let i = 0; i < offsets.length; i++) {
      const offset = offsets[i]!
      const sampled = sample(source, x + offset.x, y + offset.y, c)
      value = erode ? Math.min(value, sampled) : Math.max(value, sampled)
    }
    out.data[(y * source.width + x) * 4 + c] = value
  }
  return out
}

function convolveMatrix(
  source: SvgFilterRaster,
  primitive: SvgFilterPrimitive,
  scaleX: number,
  scaleY: number,
  transform?: [number, number, number, number, number, number],
): SvgFilterRaster {
  const a = primitive.attributes
  const order = parsePair(a.order, 3)
  const columns = Math.max(1, Math.floor(order.x))
  const rows = Math.max(1, Math.floor(order.y))
  const kernel = parseNumbers(a.kernelMatrix)
  if (kernel.length !== columns * rows) throw new Error('SVG feConvolveMatrix kernelMatrix length does not match order')
  const divisor = number(a.divisor, sum(kernel) || 1)
  if (divisor === 0) throw new Error('SVG feConvolveMatrix divisor must not be zero')
  const bias = number(a.bias, 0)
  const targetX = Math.floor(number(a.targetX, columns >> 1))
  const targetY = Math.floor(number(a.targetY, rows >> 1))
  if (targetX < 0 || targetX >= columns || targetY < 0 || targetY >= rows) throw new Error('SVG feConvolveMatrix target is outside the kernel')
  const edgeMode = a.edgeMode ?? 'duplicate'
  const unit = parsePair(a.kernelUnitLength, 0)
  if (a.kernelUnitLength !== undefined && (!(unit.x > 0) || !(unit.y > 0))) throw new Error('SVG feConvolveMatrix kernelUnitLength must be positive')
  const xStep = a.kernelUnitLength === undefined ? { x: 1, y: 0 } : transformFilterVector(unit.x, 0, transform, scaleX, scaleY)
  const yStep = a.kernelUnitLength === undefined ? { x: 0, y: 1 } : transformFilterVector(0, unit.y, transform, scaleX, scaleY)
  const preserveAlpha = a.preserveAlpha === 'true'
  const out = createRaster(source.width, source.height)
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) for (let c = 0; c < 4; c++) {
    if (preserveAlpha && c === 3) { out.data[(y * source.width + x) * 4 + c] = sample(source, x, y, c); continue }
    let value = 0
    for (let ky = 0; ky < rows; ky++) for (let kx = 0; kx < columns; kx++) {
      const sourceX = x + (kx - targetX) * xStep.x + (ky - targetY) * yStep.x
      const sourceY = y + (kx - targetX) * xStep.y + (ky - targetY) * yStep.y
      const sampleValue = preserveAlpha
        ? sampleStraightEdge(source, sourceX, sourceY, c, edgeMode)
        : sampleEdge(source, sourceX, sourceY, c, edgeMode)
      value += sampleValue * kernel[(rows - 1 - ky) * columns + columns - 1 - kx]!
    }
    const filtered = clamp(value / divisor + bias)
    out.data[(y * source.width + x) * 4 + c] = preserveAlpha ? filtered * sample(source, x, y, 3) : filtered
  }
  return out
}

function sampleEdge(source: SvgFilterRaster, x: number, y: number, channel: number, mode: string): number {
  const region = integerRegion(source.region, source.width, source.height)
  if (!(region.width > 0) || !(region.height > 0)) return 0
  let sampleX = x
  let sampleY = y
  if (mode === 'wrap') {
    sampleX = region.x + modulo(x - region.x, region.width)
    sampleY = region.y + modulo(y - region.y, region.height)
  } else if (mode === 'duplicate') {
    sampleX = Math.max(region.x, Math.min(region.x + region.width - 1, x))
    sampleY = Math.max(region.y, Math.min(region.y + region.height - 1, y))
  } else if (x < region.x || y < region.y || x >= region.x + region.width || y >= region.y + region.height) {
    return 0
  }
  const x0 = Math.floor(sampleX)
  const y0 = Math.floor(sampleY)
  return bilinear(source, x0, y0, sampleX - x0, sampleY - y0, channel)
}

function sampleStraightEdge(source: SvgFilterRaster, x: number, y: number, channel: number, mode: string): number {
  if (channel === 3) return sampleEdge(source, x, y, channel, mode)
  const color = sampleEdge(source, x, y, channel, mode)
  const alpha = sampleEdge(source, x, y, 3, mode)
  return alpha > 1e-9 ? color / alpha : 0
}

function displacementMap(
  source: SvgFilterRaster,
  map: SvgFilterRaster,
  amount: number,
  xChannel: string,
  yChannel: string,
  transform: [number, number, number, number, number, number] | undefined,
  scaleX: number,
  scaleY: number,
): SvgFilterRaster {
  const out = createRaster(source.width, source.height)
  const xc = channelIndex(xChannel)
  const yc = channelIndex(yChannel)
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const mp = (y * source.width + x) * 4
    const ma = map.data[mp + 3]!
    const xv = xc === 3 ? ma : ma > 1e-9 ? map.data[mp + xc]! / ma : 0
    const yv = yc === 3 ? ma : ma > 1e-9 ? map.data[mp + yc]! / ma : 0
    const displacement = transformFilterVector(amount * (xv - 0.5), amount * (yv - 0.5), transform, scaleX, scaleY)
    const sx = x + displacement.x
    const sy = y + displacement.y
    const x0 = Math.floor(sx)
    const y0 = Math.floor(sy)
    const p = (y * source.width + x) * 4
    for (let c = 0; c < 4; c++) out.data[p + c] = bilinear(source, x0, y0, sx - x0, sy - y0, c)
  }
  return out
}

function tileRaster(source: SvgFilterRaster, targetRegion: SvgFilterRegion): SvgFilterRaster {
  const out = createRaster(source.width, source.height)
  const tileX = Math.floor(source.region.x)
  const tileY = Math.floor(source.region.y)
  const tileWidth = Math.ceil(source.region.x + source.region.width) - tileX
  const tileHeight = Math.ceil(source.region.y + source.region.height) - tileY
  if (!(tileWidth > 0) || !(tileHeight > 0)) return out
  const target = integerRegion(targetRegion, source.width, source.height)
  for (let y = target.y; y < target.y + target.height; y++) for (let x = target.x; x < target.x + target.width; x++) {
    const sx = tileX + modulo(x - tileX, tileWidth)
    const sy = tileY + modulo(y - tileY, tileHeight)
    const sourceOffset = (sy * source.width + sx) * 4
    const targetOffset = (y * source.width + x) * 4
    for (let c = 0; c < 4; c++) out.data[targetOffset + c] = source.data[sourceOffset + c]!
  }
  return out
}

function imageRaster(
  href: string,
  width: number,
  height: number,
  region: SvgFilterRegion,
  preserveAspectRatio: string,
  colorSpace: 'linearRGB' | 'sRGB',
  referencedFragment?: SvgFilterRaster,
  imageResources?: ReadonlyMap<string, { data: Uint8Array, mimeType: string }>,
): SvgFilterRaster {
  if (href.startsWith('#')) {
    return referencedFragment === undefined ? createRaster(width, height) : referencedFragment
  }
  const comma = href.indexOf(',')
  let meta: string
  let bytes: Uint8Array
  if (href.startsWith('data:') && comma >= 0) {
    meta = href.slice(5, comma)
    const payload = href.slice(comma + 1)
    bytes = meta.includes(';base64') ? decodeBase64(payload) : new TextEncoder().encode(decodeURIComponent(payload))
  } else {
    const resource = imageResources?.get(href)
    if (resource === undefined) return createRaster(width, height)
    meta = resource.mimeType
    bytes = resource.data
  }
  let sourceWidth: number
  let sourceHeight: number
  let rgba: Uint8Array
  if (meta.startsWith('image/png')) {
    const decoded = decodePng(bytes); sourceWidth = decoded.width; sourceHeight = decoded.height; rgba = decoded.pixels
  } else if (meta.startsWith('image/jpeg')) {
    const decoded = decodeJpegToRgba(bytes); sourceWidth = decoded.width; sourceHeight = decoded.height; rgba = decoded.rgba
  } else {
    return createRaster(width, height)
  }
  const source = rasterFromBytesInColorSpace(rgba, sourceWidth, sourceHeight, colorSpace)
  const out = createRaster(width, height)
  const pixels = integerRegion(region, width, height)
  const placement = imagePlacement(region, sourceWidth, sourceHeight, preserveAspectRatio)
  for (let y = pixels.y; y < pixels.y + pixels.height; y++) for (let x = pixels.x; x < pixels.x + pixels.width; x++) {
    if (x + 0.5 < placement.x || y + 0.5 < placement.y || x + 0.5 >= placement.x + placement.width || y + 0.5 >= placement.y + placement.height) continue
    const sx = (x + 0.5 - placement.x) * sourceWidth / placement.width - 0.5
    const sy = (y + 0.5 - placement.y) * sourceHeight / placement.height - 0.5
    const x0 = Math.floor(sx)
    const y0 = Math.floor(sy)
    const dp = (y * width + x) * 4
    for (let c = 0; c < 4; c++) out.data[dp + c] = bilinearClamped(source, x0, y0, sx - x0, sy - y0, c)
  }
  return out
}

function bilinearClamped(source: SvgFilterRaster, x: number, y: number, tx: number, ty: number, channel: number): number {
  const x0 = Math.max(0, Math.min(source.width - 1, x))
  const x1 = Math.max(0, Math.min(source.width - 1, x + 1))
  const y0 = Math.max(0, Math.min(source.height - 1, y))
  const y1 = Math.max(0, Math.min(source.height - 1, y + 1))
  return sample(source, x0, y0, channel) * (1 - tx) * (1 - ty)
    + sample(source, x1, y0, channel) * tx * (1 - ty)
    + sample(source, x0, y1, channel) * (1 - tx) * ty
    + sample(source, x1, y1, channel) * tx * ty
}

function rasterFromBytesInColorSpace(
  bytes: Uint8Array,
  width: number,
  height: number,
  colorSpace: 'linearRGB' | 'sRGB',
): SvgFilterRaster {
  if (colorSpace === 'linearRGB') return rasterFromBytes(bytes, width, height)
  const out = createRaster(width, height)
  for (let i = 0; i < width * height; i++) {
    const p = i * 4
    const alpha = bytes[p + 3]! / 255
    out.data[p] = bytes[p]! / 255 * alpha
    out.data[p + 1] = bytes[p + 1]! / 255 * alpha
    out.data[p + 2] = bytes[p + 2]! / 255 * alpha
    out.data[p + 3] = alpha
  }
  return out
}

function imagePlacement(
  region: SvgFilterRegion,
  sourceWidth: number,
  sourceHeight: number,
  preserveAspectRatio: string,
): SvgFilterRegion {
  const parts = preserveAspectRatio.trim().split(/\s+/)
  const align = parts[0] ?? 'xMidYMid'
  if (align === 'none') return region
  const slice = parts[1] === 'slice'
  const scale = slice
    ? Math.max(region.width / sourceWidth, region.height / sourceHeight)
    : Math.min(region.width / sourceWidth, region.height / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  let x = region.x
  let y = region.y
  if (align.includes('xMid')) x += (region.width - width) * 0.5
  else if (align.includes('xMax')) x += region.width - width
  if (align.includes('YMid')) y += (region.height - height) * 0.5
  else if (align.includes('YMax')) y += region.height - height
  return { x, y, width, height }
}

interface TurbulenceStitch {
  width: number
  height: number
  wrapX: number
  wrapY: number
}

interface TurbulenceLattice {
  selector: Int32Array
  gradients: Float64Array
}

function turbulence(
  width: number,
  height: number,
  primitive: SvgFilterPrimitive,
  region: SvgFilterRegion,
  primitiveTransform?: [number, number, number, number, number, number],
): SvgFilterRaster {
  const a = primitive.attributes
  const frequency = parsePair(a.baseFrequency, 0)
  if (frequency.x < 0 || frequency.y < 0) throw new Error('SVG feTurbulence baseFrequency must not be negative')
  const octaves = Math.max(1, Math.floor(number(a.numOctaves, 1)))
  const seed = Math.trunc(number(a.seed, 0))
  const fractal = a.type === 'fractalNoise'
  const stitch = a.stitchTiles === 'stitch'
  const lattice = createTurbulenceLattice(seed)
  const out = createRaster(width, height)
  const pixels = integerRegion(region, width, height)
  const inverseTransform = primitiveTransform ? invertMatrix(primitiveTransform) : undefined
  const tile = inverseTransform ? transformRegion(region, inverseTransform) : region
  for (let y = pixels.y; y < pixels.y + pixels.height; y++) for (let x = pixels.x; x < pixels.x + pixels.width; x++) {
    const p = (y * width + x) * 4
    const sampleX = x
    const sampleY = y
    const pointX = inverseTransform ? inverseTransform[0] * sampleX + inverseTransform[2] * sampleY + inverseTransform[4] : sampleX
    const pointY = inverseTransform ? inverseTransform[1] * sampleX + inverseTransform[3] * sampleY + inverseTransform[5] : sampleY
    for (let c = 0; c < 4; c++) {
      const total = turbulenceValue(lattice, c, pointX, pointY, frequency.x, frequency.y, octaves, fractal, stitch, tile)
      const value = fractal ? (total + 1) * 0.5 : total
      out.data[p + c] = clamp(value)
    }
    const alpha = out.data[p + 3]!
    out.data[p] = out.data[p]! * alpha
    out.data[p + 1] = out.data[p + 1]! * alpha
    out.data[p + 2] = out.data[p + 2]! * alpha
  }
  return out
}

function invertMatrix(matrix: [number, number, number, number, number, number]): [number, number, number, number, number, number] {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
  if (Math.abs(determinant) < 1e-12) throw new Error('SVG filter primitive coordinate system is singular')
  return [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
  ]
}

function createTurbulenceLattice(seedValue: number): TurbulenceLattice {
  const size = 256
  const selector = new Int32Array(size * 2 + 2)
  const gradients = new Float64Array(4 * (size * 2 + 2) * 2)
  let seed = setupTurbulenceSeed(seedValue)
  for (let channel = 0; channel < 4; channel++) {
    for (let i = 0; i < size; i++) {
      selector[i] = i
      seed = turbulenceRandom(seed)
      let gx = (seed % (size * 2) - size) / size
      seed = turbulenceRandom(seed)
      let gy = (seed % (size * 2) - size) / size
      const length = Math.hypot(gx, gy)
      gx /= length
      gy /= length
      const offset = turbulenceGradientOffset(channel, i)
      gradients[offset] = gx
      gradients[offset + 1] = gy
    }
  }
  for (let i = size - 1; i > 0; i--) {
    seed = turbulenceRandom(seed)
    const j = seed % size
    const value = selector[i]!
    selector[i] = selector[j]!
    selector[j] = value
  }
  for (let i = 0; i < size + 2; i++) {
    selector[size + i] = selector[i]!
    for (let channel = 0; channel < 4; channel++) {
      const source = turbulenceGradientOffset(channel, i)
      const target = turbulenceGradientOffset(channel, size + i)
      gradients[target] = gradients[source]!
      gradients[target + 1] = gradients[source + 1]!
    }
  }
  return { selector, gradients }
}

function setupTurbulenceSeed(seed: number): number {
  const modulus = 2147483647
  if (seed <= 0) return -(seed % (modulus - 1)) + 1
  return seed > modulus - 1 ? modulus - 1 : seed
}

function turbulenceRandom(seed: number): number {
  const result = 16807 * (seed % 127773) - 2836 * Math.floor(seed / 127773)
  return result <= 0 ? result + 2147483647 : result
}

function turbulenceGradientOffset(channel: number, lattice: number): number {
  return (channel * 514 + lattice) * 2
}

function turbulenceValue(
  lattice: TurbulenceLattice,
  channel: number,
  x: number,
  y: number,
  baseFrequencyX: number,
  baseFrequencyY: number,
  octaves: number,
  fractal: boolean,
  stitchTiles: boolean,
  tile: SvgFilterRegion,
): number {
  let frequencyX = baseFrequencyX
  let frequencyY = baseFrequencyY
  let stitch: TurbulenceStitch | undefined
  if (stitchTiles) {
    frequencyX = adjustedStitchFrequency(tile.width, frequencyX)
    frequencyY = adjustedStitchFrequency(tile.height, frequencyY)
    const stitchWidth = Math.floor(tile.width * frequencyX + 0.5)
    const stitchHeight = Math.floor(tile.height * frequencyY + 0.5)
    stitch = {
      width: stitchWidth,
      height: stitchHeight,
      wrapX: Math.trunc(tile.x * frequencyX + 4096 + stitchWidth),
      wrapY: Math.trunc(tile.y * frequencyY + 4096 + stitchHeight),
    }
  }
  let vx = x * frequencyX
  let vy = y * frequencyY
  let ratio = 1
  let total = 0
  for (let octave = 0; octave < octaves; octave++) {
    const noise = turbulenceNoise2(lattice, channel, vx, vy, stitch)
    total += (fractal ? noise : Math.abs(noise)) / ratio
    vx *= 2
    vy *= 2
    ratio *= 2
    if (stitch) {
      stitch.width *= 2
      stitch.wrapX = stitch.wrapX * 2 - 4096
      stitch.height *= 2
      stitch.wrapY = stitch.wrapY * 2 - 4096
    }
  }
  return total
}

function adjustedStitchFrequency(size: number, frequency: number): number {
  if (frequency === 0 || size === 0) return frequency
  const low = Math.floor(size * frequency) / size
  const high = Math.ceil(size * frequency) / size
  if (low === 0) return high
  return frequency / low < high / frequency ? low : high
}

function turbulenceNoise2(
  lattice: TurbulenceLattice,
  channel: number,
  x: number,
  y: number,
  stitch: TurbulenceStitch | undefined,
): number {
  let bx0 = Math.trunc(x + 4096)
  let bx1 = bx0 + 1
  const rx0 = x + 4096 - bx0
  const rx1 = rx0 - 1
  let by0 = Math.trunc(y + 4096)
  let by1 = by0 + 1
  const ry0 = y + 4096 - by0
  const ry1 = ry0 - 1
  if (stitch) {
    if (bx0 >= stitch.wrapX) bx0 -= stitch.width
    if (bx1 >= stitch.wrapX) bx1 -= stitch.width
    if (by0 >= stitch.wrapY) by0 -= stitch.height
    if (by1 >= stitch.wrapY) by1 -= stitch.height
  }
  bx0 &= 255
  bx1 &= 255
  by0 &= 255
  by1 &= 255
  const i = lattice.selector[bx0]!
  const j = lattice.selector[bx1]!
  const b00 = lattice.selector[i + by0]!
  const b10 = lattice.selector[j + by0]!
  const b01 = lattice.selector[i + by1]!
  const b11 = lattice.selector[j + by1]!
  const sx = rx0 * rx0 * (3 - 2 * rx0)
  const sy = ry0 * ry0 * (3 - 2 * ry0)
  const u00 = turbulenceGradientDot(lattice, channel, b00, rx0, ry0)
  const u10 = turbulenceGradientDot(lattice, channel, b10, rx1, ry0)
  const u01 = turbulenceGradientDot(lattice, channel, b01, rx0, ry1)
  const u11 = turbulenceGradientDot(lattice, channel, b11, rx1, ry1)
  return lerp(lerp(u00, u10, sx), lerp(u01, u11, sx), sy)
}

function turbulenceGradientDot(lattice: TurbulenceLattice, channel: number, index: number, x: number, y: number): number {
  const offset = turbulenceGradientOffset(channel, index)
  return x * lattice.gradients[offset]! + y * lattice.gradients[offset + 1]!
}

function lighting(
  source: SvgFilterRaster,
  primitive: SvgFilterPrimitive,
  specular: boolean,
  colorSpace: 'linearRGB' | 'sRGB',
  primitiveTransform?: [number, number, number, number, number, number],
  paletteFont?: Font,
): SvgFilterRaster {
  const color = workingColor(resolvePaletteColorValue(primitive.attributes['lighting-color'] ?? '#ffffff', paletteFont).color, colorSpace)
  const surfaceScale = number(primitive.attributes.surfaceScale, 1)
  const constant = number(specular ? primitive.attributes.specularConstant : primitive.attributes.diffuseConstant, 1)
  const exponent = number(primitive.attributes.specularExponent, 1)
  const light = primitive.children[0]
  if (!light || (light.type !== 'feDistantLight' && light.type !== 'fePointLight' && light.type !== 'feSpotLight')) {
    throw new Error(`SVG <${primitive.type}> requires exactly one light-source child`)
  }
  const inverseTransform = primitiveTransform ? invertMatrix(primitiveTransform) : undefined
  const scaleX = primitiveTransform ? Math.hypot(primitiveTransform[0], primitiveTransform[1]) : 1
  const scaleY = primitiveTransform ? Math.hypot(primitiveTransform[2], primitiveTransform[3]) : 1
  const kernel = parsePair(primitive.attributes.kernelUnitLength, 0)
  if (primitive.attributes.kernelUnitLength !== undefined && (!(kernel.x > 0) || !(kernel.y > 0))) {
    throw new Error(`SVG <${primitive.type}> kernelUnitLength must be positive`)
  }
  const dxPixels = primitive.attributes.kernelUnitLength === undefined ? 1 : kernel.x * scaleX
  const dyPixels = primitive.attributes.kernelUnitLength === undefined ? 1 : kernel.y * scaleY
  const dxUnits = primitive.attributes.kernelUnitLength === undefined ? 1 / scaleX : kernel.x
  const dyUnits = primitive.attributes.kernelUnitLength === undefined ? 1 / scaleY : kernel.y
  const bounds = integerRegion(source.region, source.width, source.height)
  const out = createRaster(source.width, source.height)
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
    const gradient = surfaceGradient(source, x, y, dxPixels, dyPixels, dxUnits, dyUnits, surfaceScale, bounds)
    const normal = normalize3(-gradient.x, -gradient.y, 1)
    const point = inverseTransform
      ? {
          x: inverseTransform[0] * x + inverseTransform[2] * y + inverseTransform[4],
          y: inverseTransform[1] * x + inverseTransform[3] * y + inverseTransform[5],
        }
      : { x, y }
    const direction = lightDirection(light, point.x, point.y, sample(source, x, y, 3) * surfaceScale)
    let intensity = Math.max(0, normal.x * direction.x + normal.y * direction.y + normal.z * direction.z)
    if (specular) {
      const half = normalize3(direction.x, direction.y, direction.z + 1)
      intensity = Math.pow(Math.max(0, normal.x * half.x + normal.y * half.y + normal.z * half.z), exponent)
    }
    intensity = clamp(intensity * constant * spotLightFactor(light, direction))
    const p = (y * source.width + x) * 4
    out.data[p] = color.r * intensity
    out.data[p + 1] = color.g * intensity
    out.data[p + 2] = color.b * intensity
    out.data[p + 3] = specular ? Math.max(out.data[p]!, out.data[p + 1]!, out.data[p + 2]!) : 1
  }
  return out
}

function lightDirection(light: SvgFilterPrimitive, x: number, y: number, z: number): { x: number, y: number, z: number } {
  const a = light.attributes
  if (light.type === 'feDistantLight') {
    const azimuth = number(a.azimuth, 0) * Math.PI / 180
    const elevation = number(a.elevation, 0) * Math.PI / 180
    return normalize3(Math.cos(azimuth) * Math.cos(elevation), Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation))
  }
  return normalize3(number(a.x, 0) - x, number(a.y, 0) - y, number(a.z, 0) - z)
}

function surfaceGradient(
  source: SvgFilterRaster,
  x: number,
  y: number,
  dxPixels: number,
  dyPixels: number,
  dxUnits: number,
  dyUnits: number,
  surfaceScale: number,
  bounds: { x: number, y: number, width: number, height: number },
): { x: number, y: number } {
  const xEdge = x - dxPixels < bounds.x || x + dxPixels >= bounds.x + bounds.width
  const yEdge = y - dyPixels < bounds.y || y + dyPixels >= bounds.y + bounds.height
  const topLeft = lightAlphaSample(source, x - dxPixels, y - dyPixels, bounds)
  const topCenter = lightAlphaSample(source, x, y - dyPixels, bounds)
  const topRight = lightAlphaSample(source, x + dxPixels, y - dyPixels, bounds)
  const middleLeft = lightAlphaSample(source, x - dxPixels, y, bounds)
  const middleRight = lightAlphaSample(source, x + dxPixels, y, bounds)
  const bottomLeft = lightAlphaSample(source, x - dxPixels, y + dyPixels, bounds)
  const bottomCenter = lightAlphaSample(source, x, y + dyPixels, bounds)
  const bottomRight = lightAlphaSample(source, x + dxPixels, y + dyPixels, bounds)
  const sumX = -topLeft + topRight - 2 * middleLeft + 2 * middleRight - bottomLeft + bottomRight
  const sumY = -topLeft - 2 * topCenter - topRight + bottomLeft + 2 * bottomCenter + bottomRight
  const factorX = (xEdge ? (yEdge ? 2 / 3 : 1 / 2) : (yEdge ? 1 / 3 : 1 / 4)) / dxUnits
  const factorY = (yEdge ? (xEdge ? 2 / 3 : 1 / 2) : (xEdge ? 1 / 3 : 1 / 4)) / dyUnits
  return { x: surfaceScale * factorX * sumX, y: surfaceScale * factorY * sumY }
}

function lightAlphaSample(
  source: SvgFilterRaster,
  x: number,
  y: number,
  bounds: { x: number, y: number, width: number, height: number },
): number {
  if (x < bounds.x || y < bounds.y || x >= bounds.x + bounds.width || y >= bounds.y + bounds.height) return 0
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  return bilinear(source, x0, y0, x - x0, y - y0, 3)
}

function spotLightFactor(light: SvgFilterPrimitive, direction: { x: number, y: number, z: number }): number {
  if (light.type !== 'feSpotLight') return 1
  const a = light.attributes
  const axis = normalize3(
    number(a.pointsAtX, 0) - number(a.x, 0),
    number(a.pointsAtY, 0) - number(a.y, 0),
    number(a.pointsAtZ, 0) - number(a.z, 0),
  )
  const cosine = -(direction.x * axis.x + direction.y * axis.y + direction.z * axis.z)
  if (!(cosine > 0)) return 0
  if (a.limitingConeAngle !== undefined) {
    const limit = Math.cos(number(a.limitingConeAngle, 0) * Math.PI / 180)
    if (cosine < limit) return 0
  }
  return Math.pow(cosine, number(a.specularExponent, 1))
}

function parseColor(value: string): { r: number, g: number, b: number, a: number } {
  const color = parseCssColor(value)
  return { r: color.r / 255, g: color.g / 255, b: color.b / 255, a: color.a ?? 1 }
}

function linearColor(color: { r: number, g: number, b: number, a: number }): { r: number, g: number, b: number, a: number } {
  return { r: srgbToLinear(color.r), g: srgbToLinear(color.g), b: srgbToLinear(color.b), a: color.a }
}

function workingColor(color: { r: number, g: number, b: number, a: number }, colorSpace: 'linearRGB' | 'sRGB'): { r: number, g: number, b: number, a: number } {
  return colorSpace === 'linearRGB' ? linearColor(color) : color
}

function resolvePaletteColorValue(value: string, paletteFont?: Font): { color: { r: number, g: number, b: number, a: number }, paletteAlpha: number } {
  const match = /^var\(\s*--color(\d+)\s*(?:,\s*([^)]*))?\)$/i.exec(value.trim())
  if (match && paletteFont) {
    const palette = paletteFont.getColorFromSelectedPalette(Number(match[1]))
    if (palette) return { color: { r: palette.r / 255, g: palette.g / 255, b: palette.b / 255, a: 1 }, paletteAlpha: palette.a / 255 }
  }
  return { color: parseColor(match?.[2] ?? value), paletteAlpha: 1 }
}

function parseNumbers(value: string | undefined): number[] {
  if (!value) return []
  const parts = value.trim().split(/[\s,]+/)
  const out: number[] = []
  for (let i = 0; i < parts.length; i++) { const parsed = Number(parts[i]); if (Number.isFinite(parsed)) out.push(parsed) }
  return out
}

function parsePair(value: string | undefined, fallback: number): { x: number, y: number } {
  const values = parseNumbers(value)
  return { x: values[0] ?? fallback, y: values[1] ?? values[0] ?? fallback }
}

function number(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sum(values: number[]): number {
  let result = 0
  for (let i = 0; i < values.length; i++) result += values[i]!
  return result
}

function decodeBase64(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const cleaned = value.replace(/\s/g, '')
  const out = new Uint8Array(Math.floor(cleaned.length * 3 / 4))
  let offset = 0
  let accumulator = 0
  let bits = 0
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '=') break
    const digit = alphabet.indexOf(cleaned[i]!)
    if (digit < 0) continue
    accumulator = (accumulator << 6) | digit
    bits += 6
    if (bits >= 8) { bits -= 8; out[offset++] = (accumulator >>> bits) & 0xFF }
  }
  return out.subarray(0, offset)
}

function channelIndex(value: string): number {
  return value === 'R' ? 0 : value === 'G' ? 1 : value === 'B' ? 2 : 3
}

function averageScale(x: number, y: number): number { return (Math.abs(x) + Math.abs(y)) * 0.5 }
function modulo(value: number, divisor: number): number { return ((value % divisor) + divisor) % divisor }
function fade(value: number): number { return value * value * value * (value * (value * 6 - 15) + 10) }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }
function clamp(value: number): number { return value < 0 ? 0 : value > 1 ? 1 : value }
function srgbToLinear(value: number): number { return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4) }
function linearToSrgb(value: number): number { return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055 }
function normalize3(x: number, y: number, z: number): { x: number, y: number, z: number } { const length = Math.hypot(x, y, z) || 1; return { x: x / length, y: y / length, z: z / length } }
