import type {
  RenderDeviceParams,
  RenderHalftone,
  RenderHalftoneAngled,
  RenderHalftoneScreen,
  RenderHalftoneThreshold,
  RenderHalftoneThreshold16,
  RenderTransferFunction,
} from '../types/render.js'
import { evaluateCalculatorSource, evaluateTransferFunctionDef } from '../pdf/pdf-function.js'

const PROCESS_CMYK = new Set(['Cyan', 'Magenta', 'Yellow', 'Black'])
const PROCESS_RGB = new Set(['Red', 'Green', 'Blue'])

export const PDF_PREDEFINED_SPOT_FUNCTIONS = [
  'SimpleDot', 'InvertedSimpleDot', 'DoubleDot', 'InvertedDoubleDot',
  'CosineDot', 'Double', 'InvertedDouble', 'Line', 'LineX', 'LineY',
  'Round', 'Ellipse', 'EllipseA', 'InvertedEllipseA', 'EllipseB', 'EllipseC',
  'InvertedEllipseC', 'Square', 'Cross', 'Rhomboid', 'Diamond',
] as const

export type PdfPredefinedSpotFunction = typeof PDF_PREDEFINED_SPOT_FUNCTIONS[number]

/** Applies PDF device transfer, separation, and halftone parameters to RGBA pixels in place. */
export function applyDeviceRasterToRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  params: RenderDeviceParams,
  devicePixelsPerPoint = 1,
): void {
  validateRenderDeviceParams(params)
  if (data.length !== width * height * 4) throw new Error('Device raster RGBA length does not match its dimensions')
  if (!Number.isFinite(devicePixelsPerPoint) || devicePixelsPerPoint <= 0) throw new Error('Device raster pixels per point must be positive')
  const model = deviceRasterModel(params)
  const transfer = transferFunctions(params.transferFunction)
  const origin = params.halftoneOrigin ?? [0, 0]
  const screens = model === 'cmyk'
    ? selectedHalftones(params.halftone, ['Cyan', 'Magenta', 'Yellow', 'Black'], devicePixelsPerPoint)
    : model === 'gray'
      ? selectedHalftones(params.halftone, ['Gray'], devicePixelsPerPoint)
      : selectedHalftones(params.halftone, ['Red', 'Green', 'Blue'], devicePixelsPerPoint)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (data[offset + 3] === 0) continue
      if (model === 'cmyk') applyCmykPixel(data, offset, x, y, params, transfer, screens, origin)
      else if (model === 'gray') applyGrayPixel(data, offset, x, y, transfer, screens[0]!, origin)
      else applyRgbPixel(data, offset, x, y, transfer, screens, origin)
    }
  }
}

/**
 * Applies transfer and halftone processing to native device-component planes.
 * Values are normalized device components in interleaved pixel order. Process
 * RGB/Gray are additive; CMYK and named spot colorants are subtractive.
 */
export function applyDeviceRasterToComponents(
  data: Float64Array,
  width: number,
  height: number,
  colorants: string[],
  params: RenderDeviceParams,
  devicePixelsPerPoint = 1,
): void {
  validateRenderDeviceParams(params)
  if (colorants.length === 0) throw new Error('Device component raster requires at least one colorant')
  if (data.length !== width * height * colorants.length) throw new Error('Device component raster length does not match its dimensions and colorants')
  if (!Number.isFinite(devicePixelsPerPoint) || devicePixelsPerPoint <= 0) throw new Error('Device raster pixels per point must be positive')
  const names = new Set<string>()
  for (let component = 0; component < colorants.length; component++) {
    const colorant = colorants[component]!
    if (colorant.length === 0 || names.has(colorant)) throw new Error('Device component colorants must be non-empty and unique')
    names.add(colorant)
  }
  const screens = selectedHalftones(params.halftone, colorants, devicePixelsPerPoint)
  const origin = params.halftoneOrigin ?? [0, 0]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * colorants.length
      for (let component = 0; component < colorants.length; component++) {
        const colorant = colorants[component]!
        const subtractive = !PROCESS_RGB.has(colorant) && colorant !== 'Gray'
        const input = data[offset + component]!
        if (!Number.isFinite(input) || input < 0 || input > 1) throw new Error('Device component values must be finite numbers from 0 to 1')
        let additive = subtractive ? 1 - input : input
        const transfer = transferForColorant(params.transferFunction, colorant)
        if (transfer !== null) additive = evaluateUnitFunction(transfer, additive)
        additive = applyHalftone(screens[component]!, additive, x, y, origin)
        data[offset + component] = subtractive ? 1 - additive : additive
      }
    }
  }
}

export function validateRenderDeviceParams(params: RenderDeviceParams): void {
  if (Array.isArray(params.transferFunction) && params.transferFunction.length !== 4) {
    throw new Error('PDF transfer-function array must contain exactly four functions')
  }
  if (params.flatness !== undefined && (!Number.isFinite(params.flatness) || params.flatness < 0 || params.flatness > 100)) {
    throw new Error('PDF flatness must be between 0 and 100')
  }
  if (params.smoothness !== undefined && (!Number.isFinite(params.smoothness) || params.smoothness < 0 || params.smoothness > 1)) {
    throw new Error('PDF smoothness must be between 0 and 1')
  }
  if (params.halftoneOrigin !== undefined && (!Number.isFinite(params.halftoneOrigin[0]) || !Number.isFinite(params.halftoneOrigin[1]))) {
    throw new Error('PDF halftone origin must contain finite numbers')
  }
  if (params.halftone !== undefined && params.halftone !== 'Default') validateHalftone(params.halftone, false)
}

function validateHalftone(halftone: RenderHalftone, component: boolean): void {
  if (halftone.type === 5) {
    if (component) throw new Error('PDF type 5 halftone cannot contain another type 5 halftone')
    if (halftone.halftones.length === 0) throw new Error('PDF type 5 halftone must not be empty')
    const names = new Set<string>()
    for (let i = 0; i < halftone.halftones.length; i++) {
      const entry = halftone.halftones[i]!
      if (entry.colorant.length === 0 || names.has(entry.colorant)) throw new Error('PDF type 5 halftone colorants must be non-empty and unique')
      names.add(entry.colorant)
      validateHalftone(entry.halftone, true)
    }
    if (!names.has('Default')) throw new Error('PDF type 5 halftone requires a Default component')
    return
  }
  if (halftone.type === 6) {
    validateThresholdRectangle(halftone.width, halftone.height, halftone.thresholds, 255, 'type 6')
  } else if (halftone.type === 10) {
    if (!Number.isInteger(halftone.xsquare) || halftone.xsquare <= 0 || !Number.isInteger(halftone.ysquare) || halftone.ysquare <= 0) {
      throw new Error('PDF type 10 halftone square dimensions must be positive integers')
    }
    validateThresholds(halftone.thresholds, halftone.xsquare ** 2 + halftone.ysquare ** 2, 255, 'type 10')
  } else if (halftone.type === 16) {
    const hasWidth2 = halftone.width2 !== undefined
    const hasHeight2 = halftone.height2 !== undefined
    if (hasWidth2 !== hasHeight2) throw new Error('PDF type 16 halftone Width2 and Height2 must occur together')
    validatePositiveIntegerPair(halftone.width, halftone.height, 'type 16')
    let count = halftone.width * halftone.height
    if (halftone.width2 !== undefined && halftone.height2 !== undefined) {
      validatePositiveIntegerPair(halftone.width2, halftone.height2, 'type 16 second rectangle')
      count += halftone.width2 * halftone.height2
    }
    validateThresholds(halftone.thresholds, count, 65535, 'type 16')
  } else {
    if (!Number.isFinite(halftone.frequency) || halftone.frequency <= 0) throw new Error('PDF type 1 halftone frequency must be positive')
    if (!Number.isFinite(halftone.angle)) throw new Error('PDF type 1 halftone angle must be finite')
    if (halftone.accurateScreens !== undefined && typeof halftone.accurateScreens !== 'boolean') {
      throw new Error('PDF type 1 AccurateScreens must be a boolean')
    }
  }
}

function validateThresholdRectangle(width: number, height: number, thresholds: number[], max: number, label: string): void {
  validatePositiveIntegerPair(width, height, label)
  validateThresholds(thresholds, width * height, max, label)
}

function validatePositiveIntegerPair(width: number, height: number, label: string): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`PDF ${label} dimensions must be positive integers`)
  }
}

function validateThresholds(values: number[], count: number, max: number, label: string): void {
  if (values.length !== count) throw new Error(`PDF ${label} threshold count must be ${count}`)
  for (let i = 0; i < values.length; i++) {
    if (!Number.isInteger(values[i]) || values[i]! < 0 || values[i]! > max) throw new Error(`PDF ${label} thresholds must be integers from 0 to ${max}`)
  }
}

function deviceRasterModel(params: RenderDeviceParams): 'gray' | 'rgb' | 'cmyk' {
  if (params.blackGeneration !== undefined || params.undercolorRemoval !== undefined || Array.isArray(params.transferFunction)) return 'cmyk'
  const halftone = params.halftone
  if (halftone !== undefined && halftone !== 'Default' && halftone.type === 5) {
    let gray = false
    for (let i = 0; i < halftone.halftones.length; i++) {
      const name = halftone.halftones[i]!.colorant
      if (PROCESS_CMYK.has(name)) return 'cmyk'
      if (PROCESS_RGB.has(name)) return 'rgb'
      if (name === 'Gray') gray = true
    }
    if (gray) return 'gray'
  }
  return 'rgb'
}

function transferFunctions(
  transfer: RenderDeviceParams['transferFunction'],
): RenderTransferFunction[] | null {
  if (transfer === undefined || transfer === 'Identity' || transfer === 'Default') return null
  return Array.isArray(transfer) ? transfer : [transfer, transfer, transfer, transfer]
}

function transferForColorant(
  transfer: RenderDeviceParams['transferFunction'],
  colorant: string,
): RenderTransferFunction | null {
  if (transfer === undefined || transfer === 'Identity' || transfer === 'Default') return null
  let index = -1
  if (colorant === 'Red' || colorant === 'Cyan') index = 0
  else if (colorant === 'Green' || colorant === 'Magenta') index = 1
  else if (colorant === 'Blue' || colorant === 'Yellow') index = 2
  else if (colorant === 'Gray' || colorant === 'Black') index = 3
  if (index < 0) return null
  return Array.isArray(transfer) ? transfer[index]! : transfer
}

function applyRgbPixel(
  data: Uint8ClampedArray,
  offset: number,
  x: number,
  y: number,
  transfer: RenderTransferFunction[] | null,
  screens: SelectedHalftone[],
  origin: [number, number],
): void {
  for (let component = 0; component < 3; component++) {
    let value = data[offset + component]! / 255
    if (transfer !== null) value = evaluateUnitFunction(transfer[component]!, value)
    value = applyHalftone(screens[component]!, value, x, y, origin)
    data[offset + component] = Math.round(value * 255)
  }
}

function applyGrayPixel(
  data: Uint8ClampedArray,
  offset: number,
  x: number,
  y: number,
  transfer: RenderTransferFunction[] | null,
  screen: SelectedHalftone,
  origin: [number, number],
): void {
  let value = (data[offset]! * 0.2126 + data[offset + 1]! * 0.7152 + data[offset + 2]! * 0.0722) / 255
  if (transfer !== null) value = evaluateUnitFunction(transfer[3]!, value)
  value = applyHalftone(screen, value, x, y, origin)
  const byte = Math.round(value * 255)
  data[offset] = byte
  data[offset + 1] = byte
  data[offset + 2] = byte
}

function applyCmykPixel(
  data: Uint8ClampedArray,
  offset: number,
  x: number,
  y: number,
  params: RenderDeviceParams,
  transfer: RenderTransferFunction[] | null,
  screens: SelectedHalftone[],
  origin: [number, number],
): void {
  const c0 = 1 - data[offset]! / 255
  const m0 = 1 - data[offset + 1]! / 255
  const y0 = 1 - data[offset + 2]! / 255
  const undercolor = Math.min(c0, m0, y0)
  const removal = params.undercolorRemoval === undefined || params.undercolorRemoval === 'Default'
    ? undercolor
    : evaluateUnitCalculator(params.undercolorRemoval.expression, undercolor)
  const black = params.blackGeneration === undefined || params.blackGeneration === 'Default'
    ? undercolor
    : evaluateUnitCalculator(params.blackGeneration.expression, undercolor)
  const components = [clamp01(c0 - removal), clamp01(m0 - removal), clamp01(y0 - removal), clamp01(black)]
  for (let component = 0; component < 4; component++) {
    let additive = 1 - components[component]!
    if (transfer !== null) additive = evaluateUnitFunction(transfer[component]!, additive)
    additive = applyHalftone(screens[component]!, additive, x, y, origin)
    components[component] = 1 - additive
  }
  data[offset] = Math.round((1 - Math.min(1, components[0]! + components[3]!)) * 255)
  data[offset + 1] = Math.round((1 - Math.min(1, components[1]! + components[3]!)) * 255)
  data[offset + 2] = Math.round((1 - Math.min(1, components[2]! + components[3]!)) * 255)
}

type HalftoneScreen = Exclude<RenderHalftone, { type: 5 }>

interface CompiledType1Screen {
  cosScale: number
  sinScale: number
  ordinaryCellX: number
  ordinaryCellY: number
  ordinaryArea: number
  ordinaryThresholds: Map<number, number> | null
  accurateSide: number
  accurateThresholds: Float64Array | null
}

interface CompiledThresholdStrip {
  width: number
  height: number
  shift: number
  maximum: 255 | 65535
  values: Uint16Array
}

interface CompiledHalftone {
  screen: HalftoneScreen
  type1: CompiledType1Screen | null
  thresholdStrip: CompiledThresholdStrip | null
}

type SelectedHalftone = CompiledHalftone | null

function selectedHalftones(
  halftone: RenderDeviceParams['halftone'],
  colorants: string[],
  devicePixelsPerPoint: number,
): SelectedHalftone[] {
  const selected = new Array<SelectedHalftone>(colorants.length)
  if (halftone === undefined || halftone === 'Default') {
    selected.fill(null)
    return selected
  }
  if (halftone.type !== 5) {
    selected.fill(compileHalftone(halftone, devicePixelsPerPoint))
    return selected
  }
  let defaultScreen: HalftoneScreen | null = null
  for (let i = 0; i < halftone.halftones.length; i++) {
    const entry = halftone.halftones[i]!
    if (entry.colorant === 'Default') {
      defaultScreen = entry.halftone
      break
    }
  }
  for (let component = 0; component < colorants.length; component++) {
    let screen = defaultScreen
    const colorant = colorants[component]!
    for (let i = 0; i < halftone.halftones.length; i++) {
      const entry = halftone.halftones[i]!
      if (entry.colorant === colorant) {
        screen = entry.halftone
        break
      }
    }
    selected[component] = screen === null ? null : compileHalftone(screen, devicePixelsPerPoint)
  }
  return selected
}

function compileHalftone(screen: HalftoneScreen, devicePixelsPerPoint: number): CompiledHalftone {
  if (screen.type === 6) return { screen, type1: null, thresholdStrip: null }
  if (screen.type === 10 || screen.type === 16) {
    return { screen, type1: null, thresholdStrip: compileThresholdStrip(screen) }
  }
  const radians = screen.angle * Math.PI / 180
  const deviceResolution = 72 * devicePixelsPerPoint
  let cosScale: number
  let sinScale: number
  let ordinaryCellX = 0
  let ordinaryCellY = 0
  let ordinaryArea = 0
  let ordinaryThresholds: Map<number, number> | null = null
  let accurateSide = 0
  let accurateThresholds: Float64Array | null = null
  if (screen.accurateScreens === true) {
    const scale = screen.frequency / deviceResolution
    cosScale = Math.cos(radians) * scale
    sinScale = Math.sin(radians) * scale
    const sampleSide = 256
    accurateSide = sampleSide
    const samples: Array<{ spot: number, index: number }> = new Array(sampleSide * sampleSide)
    let index = 0
    for (let y = 0; y < sampleSide; y++) {
      const sy = (y + 0.5) * 2 / sampleSide - 1
      for (let x = 0; x < sampleSide; x++) {
        const sx = (x + 0.5) * 2 / sampleSide - 1
        samples[index] = { spot: spotFunctionValue(screen, sx, sy), index }
        index++
      }
    }
    samples.sort(compareSpotSamples)
    accurateThresholds = new Float64Array(samples.length)
    for (let rank = 0; rank < samples.length; rank++) accurateThresholds[samples[rank]!.index] = (rank + 0.5) / samples.length
  } else {
    const requestedCellSide = deviceResolution / screen.frequency
    let cellX = Math.round(Math.cos(radians) * requestedCellSide)
    let cellY = Math.round(Math.sin(radians) * requestedCellSide)
    if (cellX === 0 && cellY === 0) {
      if (Math.abs(Math.cos(radians)) >= Math.abs(Math.sin(radians))) cellX = Math.sign(Math.cos(radians)) || 1
      else cellY = Math.sign(Math.sin(radians)) || 1
    }
    const area = cellX * cellX + cellY * cellY
    cosScale = cellX / area
    sinScale = cellY / area
    ordinaryCellX = cellX
    ordinaryCellY = cellY
    ordinaryArea = area
    const rowCount = greatestCommonDivisor(Math.abs(cellX), Math.abs(cellY))
    const columnCount = area / rowCount
    const samples: Array<{ spot: number, key: number, index: number }> = new Array(area)
    let index = 0
    for (let y = 0; y < rowCount; y++) {
      for (let x = 0; x < columnCount; x++) {
        const uNumerator = positiveMod(x * cellX + y * cellY, area)
        const vNumerator = positiveMod(-x * cellY + y * cellX, area)
        const sx = uNumerator / area * 2 - 1
        const sy = vNumerator / area * 2 - 1
        samples[index] = { spot: spotFunctionValue(screen, sx, sy), key: uNumerator * area + vNumerator, index }
        index++
      }
    }
    samples.sort(compareSpotSamples)
    ordinaryThresholds = new Map<number, number>()
    for (let rank = 0; rank < samples.length; rank++) ordinaryThresholds.set(samples[rank]!.key, (rank + 0.5) / samples.length)
  }
  return {
    screen,
    type1: {
      cosScale,
      sinScale,
      ordinaryCellX,
      ordinaryCellY,
      ordinaryArea,
      ordinaryThresholds,
      accurateSide,
      accurateThresholds,
    },
    thresholdStrip: null,
  }
}

function applyHalftone(
  screen: SelectedHalftone,
  value: number,
  x: number,
  y: number,
  origin: [number, number],
): number {
  if (screen === null) return value
  const definition = screen.screen
  if (definition.transferFunction !== undefined && definition.transferFunction !== 'Identity') {
    value = evaluateUnitFunction(definition.transferFunction, value)
  }
  const px = Math.floor(x - origin[0])
  const py = Math.floor(y - origin[1])
  const threshold = halftoneThreshold(screen, px, py)
  return value >= threshold ? 1 : 0
}

function halftoneThreshold(
  compiled: CompiledHalftone,
  x: number,
  y: number,
): number {
  const screen = compiled.screen
  if (screen.type === 6) {
    const index = positiveMod(y, screen.height) * screen.width + positiveMod(x, screen.width)
    return Math.max(1, screen.thresholds[index]!) / 255
  }
  if (screen.type === 10 || screen.type === 16) {
    const strip = compiled.thresholdStrip!
    const stripRow = positiveMod(y, strip.height)
    const stripNumber = Math.floor(y / strip.height)
    const stripColumn = positiveMod(x + strip.shift * stripNumber, strip.width)
    return Math.max(1, strip.values[stripRow * strip.width + stripColumn]!) / strip.maximum
  }
  const type1 = compiled.type1!
  if (type1.ordinaryThresholds !== null) {
    const uNumerator = positiveMod(x * type1.ordinaryCellX + y * type1.ordinaryCellY, type1.ordinaryArea)
    const vNumerator = positiveMod(-x * type1.ordinaryCellY + y * type1.ordinaryCellX, type1.ordinaryArea)
    const threshold = type1.ordinaryThresholds.get(uNumerator * type1.ordinaryArea + vNumerator)
    if (threshold === undefined) throw new Error('PDF type 1 halftone lattice is incomplete')
    return threshold
  }
  const u = x * type1.cosScale + y * type1.sinScale
  const v = -x * type1.sinScale + y * type1.cosScale
  const sampleX = Math.min(type1.accurateSide - 1, Math.floor(positiveFraction(u) * type1.accurateSide))
  const sampleY = Math.min(type1.accurateSide - 1, Math.floor(positiveFraction(v) * type1.accurateSide))
  return type1.accurateThresholds![sampleY * type1.accurateSide + sampleX]!
}

function spotFunctionValue(screen: RenderHalftoneScreen, x: number, y: number): number {
  return typeof screen.spotFunction === 'string'
    ? evaluatePredefinedSpotFunction(screen.spotFunction, x, y)
    : evaluateCalculatorSource(screen.spotFunction.expression, [x, y], 1)[0]!
}

function compareSpotSamples(left: { spot: number, index: number }, right: { spot: number, index: number }): number {
  return left.spot === right.spot ? left.index - right.index : left.spot - right.spot
}

function compileThresholdStrip(screen: RenderHalftoneAngled | RenderHalftoneThreshold16): CompiledThresholdStrip {
  const width1 = screen.type === 10 ? screen.xsquare : screen.width
  const height1 = screen.type === 10 ? screen.xsquare : screen.height
  const width2 = screen.type === 10 ? screen.ysquare : screen.width2 ?? 0
  const height2 = screen.type === 10 ? screen.ysquare : screen.height2 ?? 0
  const size1 = width1 * height1
  const size = size1 + width2 * height2
  const stripHeight = height2 === 0 ? height1 : greatestCommonDivisor(height1, height2)
  const stripWidth = size / stripHeight
  let shift = 0
  if (height2 !== 0) {
    let sourceY = 0
    do {
      if (sourceY < height1) {
        shift += width1
        sourceY += height2
      } else {
        shift += width2
        sourceY -= height1
      }
    } while (sourceY > stripHeight)
    if (sourceY === 0) shift = 0
  }

  const values = new Uint16Array(size)
  let destination = 0
  for (let row = 0; row < stripHeight; row++) {
    let sourceY = row
    for (let x = 0; x < stripWidth;) {
      if (sourceY < height1) {
        const source = sourceY * width1
        for (let column = 0; column < width1; column++) values[destination++] = screen.thresholds[source + column]!
        x += width1
        sourceY += height2
      } else {
        const source = size1 + (sourceY - height1) * width2
        for (let column = 0; column < width2; column++) values[destination++] = screen.thresholds[source + column]!
        x += width2
        sourceY -= height1
      }
    }
  }
  return {
    width: stripWidth,
    height: stripHeight,
    shift: positiveMod(shift, stripWidth),
    maximum: screen.type === 10 ? 255 : 65535,
    values,
  }
}

export function evaluatePredefinedSpotFunction(name: string, x: number, y: number): number {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  if (name === 'Round') {
    if (ax + ay <= 1) return 1 - x * x - y * y
    return (ax - 1) * (ax - 1) + (ay - 1) * (ay - 1) - 1
  }
  if (name === 'Ellipse') {
    const w = 3 * ax + 4 * ay - 3
    if (w < 0) return 1 - (x * x + (y / 0.75) * (y / 0.75)) / 4
    if (w > 1) return ((1 - ax) * (1 - ax) + ((1 - ay) / 0.75) * ((1 - ay) / 0.75)) / 4 - 1
    return 0.5 - w
  }
  if (name === 'EllipseA') return 1 - x * x - 0.9 * y * y
  if (name === 'InvertedEllipseA') return x * x + 0.9 * y * y - 1
  if (name === 'EllipseB') return 1 - Math.sqrt(x * x + 5 * y * y / 8)
  if (name === 'EllipseC') return 1 - 0.9 * x * x - y * y
  if (name === 'InvertedEllipseC') return 0.9 * x * x + y * y - 1
  if (name === 'Line') return -ay
  if (name === 'LineX') return x
  if (name === 'LineY') return y
  if (name === 'Square') return -Math.max(ax, ay)
  if (name === 'Cross') return -Math.min(ax, ay)
  if (name === 'Rhomboid') return (0.9 * ax + ay) / 2
  if (name === 'Diamond') {
    const sum = ax + ay
    if (sum <= 0.75) return 1 - x * x - y * y
    if (sum <= 1.23) return 1 - 0.85 * ax - ay
    return (ax - 1) * (ax - 1) + (ay - 1) * (ay - 1) - 1
  }
  if (name === 'SimpleDot') return 1 - (x * x + y * y)
  if (name === 'InvertedSimpleDot') return -evaluatePredefinedSpotFunction('SimpleDot', x, y)
  if (name === 'DoubleDot') return (Math.sin(2 * Math.PI * x) + Math.sin(2 * Math.PI * y)) / 2
  if (name === 'InvertedDoubleDot') return -evaluatePredefinedSpotFunction('DoubleDot', x, y)
  if (name === 'Double') return (Math.sin(Math.PI * x) + Math.sin(2 * Math.PI * y)) / 2
  if (name === 'InvertedDouble') return -evaluatePredefinedSpotFunction('Double', x, y)
  if (name === 'CosineDot') return (Math.cos(Math.PI * x) + Math.cos(Math.PI * y)) / 2
  throw new Error(`Unsupported PDF predefined spot function: ${name}`)
}

function evaluateUnitFunction(fn: RenderTransferFunction, value: number): number {
  return clamp01(evaluateTransferFunctionDef(fn, clamp01(value)))
}

function evaluateUnitCalculator(expression: string, value: number): number {
  return clamp01(evaluateCalculatorSource(expression, [clamp01(value)], 1)[0]!)
}

function positiveMod(value: number, divisor: number): number {
  const result = value % divisor
  return result < 0 ? result + divisor : result
}

function positiveFraction(value: number): number {
  return value - Math.floor(value)
}

function greatestCommonDivisor(a: number, b: number): number {
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
