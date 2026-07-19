import type { BlendMode, OverprintMode } from '../types/render.js'
import type { PdfSpecialColorDef } from '../types/template.js'
import { evaluatePdfFunctionDef } from '../pdf/pdf-function.js'
import {
  parseIccOutputProfile,
  parseIccProfile,
  type IccRenderingIntent,
} from '../pdf/icc-profile-reader.js'
import { parseTemplateColor } from './color.js'
import { blendPdfColor, compositePdfPixel } from './pdf-compositor.js'
import { generateCmykIccProfile } from './icc-profile.js'

const PROCESS_COLORANTS = ['Cyan', 'Magenta', 'Yellow', 'Black'] as const

export type PdfPrintColorKind = 'gray' | 'rgb' | 'cmyk' | 'separation' | 'deviceN'

/** Native colorants plus the process-color preview of one PDF paint value. */
export interface PdfPrintColor {
  kind: PdfPrintColorKind
  colorants: string[]
  components: number[]
  processCmyk: [number, number, number, number]
  displayRgb: [number, number, number]
}

/** One solid paint observed while an overprint object is rasterized. */
export interface PdfOverprintPaint {
  color: PdfPrintColor
  stroke: boolean
}

/** Bidirectional process-color transform owned by one CMYK output profile. */
export interface PdfPrintColorTransform {
  rgbToProcess(rgb: readonly [number, number, number]): [number, number, number, number]
  processToRgb(cmyk: readonly [number, number, number, number]): [number, number, number]
}

let builtInPrintColorTransform: PdfPrintColorTransform | undefined

/** Creates the process-color preview transform from the same ICC profile used for print output. */
export function createPdfPrintColorTransform(
  profile: Uint8Array,
  intent: IccRenderingIntent = 'RelativeColorimetric',
): PdfPrintColorTransform {
  const output = parseIccOutputProfile(profile)
  const input = parseIccProfile(profile)
  if (output.destinationColorSpace !== 'CMYK' || output.components !== 4) {
    throw new Error('PDF print color transform requires a four-component CMYK output profile')
  }
  if (input === null || input.sourceColorSpace !== 'CMYK' || input.components !== 4) {
    throw new Error('PDF print color transform requires a CMYK profile with an A2B transform')
  }
  return {
    rgbToProcess(rgb: readonly [number, number, number]): [number, number, number, number] {
      const result = output.fromRgb(rgb, intent)
      if (result.length !== 4) throw new Error('ICC output transform did not produce four CMYK components')
      return [result[0]!, result[1]!, result[2]!, result[3]!]
    },
    processToRgb(cmyk: readonly [number, number, number, number]): [number, number, number] {
      return input.toRgb([cmyk[0], cmyk[1], cmyk[2], cmyk[3]], intent)
    },
  }
}

function defaultPrintColorTransform(): PdfPrintColorTransform {
  if (builtInPrintColorTransform === undefined) {
    builtInPrintColorTransform = createPdfPrintColorTransform(generateCmykIccProfile())
  }
  return builtInPrintColorTransform
}

/** Resolves template and imported PDF solid paints without discarding plates. */
export function resolvePdfPrintColor(
  paint: string | PdfSpecialColorDef,
  transform: PdfPrintColorTransform = defaultPrintColorTransform(),
): PdfPrintColor {
  if (typeof paint !== 'string') return resolveSpecialColor(paint, transform)
  const parsed = parseTemplateColor(paint)
  const displayRgb: [number, number, number] = [parsed.r, parsed.g, parsed.b]
  if (parsed.deviceN !== null) {
    return {
      kind: 'deviceN',
      colorants: parsed.deviceN.names.slice(),
      components: parsed.deviceN.tints.slice(),
      processCmyk: parsed.deviceN.alternateCmyk.slice() as [number, number, number, number],
      displayRgb,
    }
  }
  if (parsed.spotName !== null) {
    return {
      kind: 'separation',
      colorants: [parsed.spotName],
      components: [1],
      processCmyk: parsed.cmyk!.slice() as [number, number, number, number],
      displayRgb,
    }
  }
  if (parsed.cmyk !== null) {
    return {
      kind: 'cmyk',
      colorants: PROCESS_COLORANTS.slice(),
      components: parsed.cmyk.slice(),
      processCmyk: parsed.cmyk.slice() as [number, number, number, number],
      displayRgb,
    }
  }
  const kind: PdfPrintColorKind = parsed.calibrated?.kind === 'calgray' ? 'gray' : 'rgb'
  const processCmyk = transform.rgbToProcess(displayRgb)
  return {
    kind,
    colorants: PROCESS_COLORANTS.slice(),
    components: processCmyk.slice(),
    processCmyk,
    displayRgb,
  }
}

/**
 * Applies one source color to an interleaved native plate raster. Unspecified
 * plates are knocked out when overprint is disabled and preserved when it is
 * enabled. OPM 1 suppresses zero DeviceCMYK process components.
 */
export function compositePdfPrintPlates(
  plates: Float64Array,
  colorants: string[],
  color: PdfPrintColor,
  alpha: number,
  overprint: boolean,
  mode: OverprintMode,
): void {
  if (colorants.length === 0 || plates.length % colorants.length !== 0) {
    throw new Error('PDF print plate raster does not match its colorant count')
  }
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('PDF print plate alpha must be from 0 to 1')
  const indexes = new Map<string, number>()
  for (let i = 0; i < colorants.length; i++) {
    if (colorants[i]!.length === 0 || indexes.has(colorants[i]!)) throw new Error('PDF print plate colorants must be non-empty and unique')
    indexes.set(colorants[i]!, i)
  }
  const source = new Float64Array(colorants.length)
  const active = new Uint8Array(colorants.length)
  if (color.kind === 'cmyk' || color.kind === 'rgb' || color.kind === 'gray') {
    for (let component = 0; component < PROCESS_COLORANTS.length; component++) {
      const index = indexes.get(PROCESS_COLORANTS[component]!)
      if (index === undefined) continue
      source[index] = color.processCmyk[component]!
      active[index] = overprint && mode === 1 && color.kind === 'cmyk' && source[index] === 0 ? 0 : 1
    }
  } else {
    for (let component = 0; component < color.colorants.length; component++) {
      const name = color.colorants[component]!
      if (name === 'None') continue
      if (name === 'All') {
        for (let plate = 0; plate < colorants.length; plate++) {
          source[plate] = color.components[component]!
          active[plate] = 1
        }
        continue
      }
      const index = indexes.get(name)
      if (index !== undefined) {
        source[index] = color.components[component]!
        active[index] = 1
      }
    }
  }
  if (!overprint) active.fill(1)
  for (let offset = 0; offset < plates.length; offset += colorants.length) {
    for (let component = 0; component < colorants.length; component++) {
      const current = plates[offset + component]!
      if (!Number.isFinite(current) || current < 0 || current > 1) throw new Error('PDF print plate values must be finite numbers from 0 to 1')
      if (active[component] !== 0) plates[offset + component] = current + (source[component]! - current) * alpha
    }
  }
}

/** Composites an overprint object into an RGBA preview using native plate rules. */
export function compositePdfOverprintRgba(
  target: Uint8ClampedArray,
  source: Uint8ClampedArray,
  paints: readonly PdfOverprintPaint[],
  fillOverprint: boolean,
  strokeOverprint: boolean,
  mode: OverprintMode,
  blendMode: BlendMode,
  transform: PdfPrintColorTransform = defaultPrintColorTransform(),
): void {
  if (target.length !== source.length || target.length % 4 !== 0) throw new Error('PDF overprint RGBA buffers must have identical pixel counts')
  for (let offset = 0; offset < target.length; offset += 4) {
    const sourceAlpha = source[offset + 3]! / 255
    if (sourceAlpha === 0) continue
    const paint = closestPaint(source, offset, paints)
    const overprint = paint !== null && (paint.stroke ? strokeOverprint : fillOverprint)
    if (!overprint) {
      const result = compositePdfPixel(target, offset, source, offset, blendMode)
      target[offset] = Math.round(result[0] * 255)
      target[offset + 1] = Math.round(result[1] * 255)
      target[offset + 2] = Math.round(result[2] * 255)
      target[offset + 3] = Math.round(result[3] * 255)
      continue
    }
    const backdropRgb: [number, number, number] = [target[offset]! / 255, target[offset + 1]! / 255, target[offset + 2]! / 255]
    const backdropAlpha = target[offset + 3]! / 255
    const color = paint.color
    const blendedRgb = blendPdfColor(backdropRgb, color.displayRgb, blendMode)
    const sourceCmyk = blendMode === 'normal' ? color.processCmyk : transform.rgbToProcess(blendedRgb)
    const destinationCmyk = transform.rgbToProcess(backdropRgb)
    if (color.kind === 'separation' || color.kind === 'deviceN') {
      for (let component = 0; component < 4; component++) {
        const addedInk = 1 - (1 - destinationCmyk[component]!) * (1 - sourceCmyk[component]!)
        destinationCmyk[component] = destinationCmyk[component]! + (addedInk - destinationCmyk[component]!) * sourceAlpha
      }
    } else {
      for (let component = 0; component < 4; component++) {
        const active = !(mode === 1 && color.kind === 'cmyk' && sourceCmyk[component] === 0)
        if (active) destinationCmyk[component] = destinationCmyk[component]! + (sourceCmyk[component]! - destinationCmyk[component]!) * sourceAlpha
      }
    }
    const outputRgb = transform.processToRgb(destinationCmyk)
    const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha)
    target[offset] = Math.round(outputRgb[0] * 255)
    target[offset + 1] = Math.round(outputRgb[1] * 255)
    target[offset + 2] = Math.round(outputRgb[2] * 255)
    target[offset + 3] = Math.round(outputAlpha * 255)
  }
}

function resolveSpecialColor(paint: PdfSpecialColorDef, transform: PdfPrintColorTransform): PdfPrintColor {
  const displayRgb = parseHexRgb(paint.displayColor)
  const alternate = evaluatePdfFunctionDef(paint.colorSpace.tintTransform, paint.components)
  const processCmyk = paint.colorSpace.alternate.kind === 'cmyk' && alternate.length === 4
    ? alternate.map(clamp01) as [number, number, number, number]
    : transform.rgbToProcess(displayRgb)
  return {
    kind: paint.colorSpace.kind === 'separation' ? 'separation' : 'deviceN',
    colorants: paint.colorSpace.kind === 'separation' ? [paint.colorSpace.name] : paint.colorSpace.names.slice(),
    components: paint.components.map(clamp01),
    processCmyk,
    displayRgb,
  }
}

function closestPaint(source: Uint8ClampedArray, offset: number, paints: readonly PdfOverprintPaint[]): PdfOverprintPaint | null {
  if (paints.length === 0) return null
  const r = source[offset]! / 255
  const g = source[offset + 1]! / 255
  const b = source[offset + 2]! / 255
  let best = paints[0]!
  let bestDistance = Infinity
  for (let i = 0; i < paints.length; i++) {
    const color = paints[i]!.color.displayRgb
    const dr = r - color[0]
    const dg = g - color[1]
    const db = b - color[2]
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      best = paints[i]!
      bestDistance = distance
    }
  }
  return best
}

function parseHexRgb(value: string): [number, number, number] {
  const parsed = parseTemplateColor(value)
  return [parsed.r, parsed.g, parsed.b]
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
