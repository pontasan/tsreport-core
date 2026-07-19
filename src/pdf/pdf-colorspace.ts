import { PdfDocument, PdfName, PdfStream, PdfString, type PdfDict, type PdfValue } from './pdf-parser.js'
import { xyzWithWhitePointToSrgb } from './xyz-color.js'
import { parseIccProfile, type IccRenderingIntent, type IccTransform } from './icc-profile-reader.js'
import { evaluatePdfFunction } from './pdf-function.js'
import { readPdfFunctionDef } from './pdf-function.js'
import type { PdfDeviceNColorSpaceDef, PdfProcessColorSpaceDef, PdfSeparationColorSpaceDef, PdfShadingColorSpaceDef, PdfSpecialColorDef } from '../types/template.js'

export type PdfColorSpace =
  | { kind: 'gray' }
  | { kind: 'rgb' }
  | { kind: 'cmyk' }
  | { kind: 'calgray'; whitePoint: [number, number, number]; blackPoint: [number, number, number]; gamma: number }
  | { kind: 'calrgb'; whitePoint: [number, number, number]; blackPoint: [number, number, number]; gamma: [number, number, number]; matrix: [number, number, number, number, number, number, number, number, number] }
  | { kind: 'lab'; whitePoint: [number, number, number]; blackPoint: [number, number, number]; aMin: number; aMax: number; bMin: number; bMax: number }
  | { kind: 'separation'; name: string; alternate: PdfColorSpace; tintTransform: PdfValue }
  | { kind: 'deviceN'; names: string[]; alternate: PdfColorSpace; tintTransform: PdfValue; attributes: PdfDeviceNAttributes | null }
  | { kind: 'indexed'; base: PdfColorSpace; high: number; lookup: Uint8Array }
  | { kind: 'icc'; transform: IccTransform; range: number[]; profile: Uint8Array }
  | { kind: 'pattern'; base: PdfColorSpace | null }

export interface PdfDeviceNAttributes {
  subtype: 'DeviceN' | 'NChannel'
  colorants: Map<string, Extract<PdfColorSpace, { kind: 'separation' }>>
  process: PdfDeviceNProcess | null
  mixingHints: PdfDeviceNMixingHints | null
}

export interface PdfDeviceNProcess {
  colorSpace: PdfColorSpace
  components: string[]
}

export interface PdfDeviceNMixingHints {
  solidities: Map<string, number>
  printingOrder: string[]
  dotGain: Map<string, PdfValue>
}

export function parsePdfColorSpace(doc: PdfDocument, value: PdfValue, resources?: PdfDict | null): PdfColorSpace {
  const resolved = doc.resolve(value)
  if (resolved instanceof PdfName) {
    const direct = directColorSpaceName(resolved.name)
    if (direct !== null) {
      const defaultName = resolved.name === 'DeviceGray' || resolved.name === 'G' ? 'DefaultGray'
        : resolved.name === 'DeviceRGB' || resolved.name === 'RGB' ? 'DefaultRGB'
          : resolved.name === 'DeviceCMYK' || resolved.name === 'CMYK' ? 'DefaultCMYK' : null
      if (defaultName !== null && resources !== null && resources !== undefined) {
        const colorSpaces = doc.resolve(resources.get('ColorSpace') ?? null)
        if (colorSpaces instanceof Map) {
          const replacement = doc.resolve(colorSpaces.get(defaultName) ?? null)
          if (replacement !== null && (!(replacement instanceof PdfName) || replacement.name !== resolved.name)) {
            return parsePdfColorSpace(doc, replacement, resources)
          }
        }
      }
      return direct
    }
    if (resources !== null && resources !== undefined) {
      const colorSpaces = doc.resolve(resources.get('ColorSpace') ?? null)
      if (colorSpaces instanceof Map) {
        const resource = colorSpaces.get(resolved.name)
        if (resource !== undefined) return parsePdfColorSpace(doc, resource, resources)
      }
    }
    throw new Error(`PDF import error: unsupported color space /${resolved.name}`)
  }
  if (!Array.isArray(resolved) || resolved.length === 0) throw new Error('PDF import error: color space must be a name or array')
  const kind = doc.resolve(resolved[0]!)
  if (!(kind instanceof PdfName)) throw new Error('PDF import error: color space array must start with a name')
  if (kind.name === 'CalGray') return parseCalGrayColorSpace(doc, resolved)
  if (kind.name === 'CalRGB') return parseCalRgbColorSpace(doc, resolved)
  if (kind.name === 'Lab') return parseLabColorSpace(doc, resolved)
  if (kind.name === 'ICCBased') return parseIccBasedColorSpace(doc, resolved, resources)
  if (kind.name === 'Separation') return parseSeparationColorSpace(doc, resolved, resources)
  if (kind.name === 'DeviceN') return parseDeviceNColorSpace(doc, resolved, resources)
  if (kind.name === 'Indexed' || kind.name === 'I') return parseIndexedColorSpace(doc, resolved, resources)
  if (kind.name === 'Pattern') return parsePatternColorSpace(doc, resolved, resources)
  throw new Error(`PDF import error: unsupported color space array /${kind.name}`)
}

export function pdfColorSpaceComponents(colorSpace: PdfColorSpace): number {
  if (colorSpace.kind === 'pattern') {
    if (colorSpace.base === null) throw new Error('PDF import error: Pattern color space without a base has no color components')
    return pdfColorSpaceComponents(colorSpace.base)
  }
  if (colorSpace.kind === 'gray' || colorSpace.kind === 'calgray' || colorSpace.kind === 'separation' || colorSpace.kind === 'indexed') return 1
  if (colorSpace.kind === 'rgb' || colorSpace.kind === 'calrgb' || colorSpace.kind === 'lab') return 3
  if (colorSpace.kind === 'deviceN') return colorSpace.names.length
  if (colorSpace.kind === 'icc') return colorSpace.transform.components
  return 4
}

export function pdfColorToHex(doc: PdfDocument, colorSpace: PdfColorSpace, components: number[], intent?: IccRenderingIntent, blackPointCompensation = false, deviceCmykTransform?: IccTransform): string {
  const rgb = pdfColorToRgb(doc, colorSpace, components, intent, blackPointCompensation, deviceCmykTransform)
  return '#' + byteHex(rgb[0]) + byteHex(rgb[1]) + byteHex(rgb[2])
}

export function pdfSpecialColorDef(doc: PdfDocument, colorSpace: PdfColorSpace, components: number[], intent?: IccRenderingIntent, blackPointCompensation = false, deviceCmykTransform?: IccTransform): PdfSpecialColorDef | null {
  if (colorSpace.kind !== 'separation' && colorSpace.kind !== 'deviceN') return null
  return {
    type: 'pdfSpecialColor',
    colorSpace: specialColorSpaceDef(doc, colorSpace),
    components: components.slice(),
    displayColor: pdfColorToHex(doc, colorSpace, components, intent, blackPointCompensation, deviceCmykTransform),
  }
}

/** Converts every color space permitted by a shading dictionary to its serializable model. */
export function pdfShadingColorSpaceDef(doc: PdfDocument, colorSpace: PdfColorSpace): PdfShadingColorSpaceDef {
  if (colorSpace.kind === 'pattern') throw new Error('PDF import error: Pattern color space is not permitted in a shading')
  if (colorSpace.kind === 'indexed') {
    const base = pdfShadingColorSpaceDef(doc, colorSpace.base)
    if (base.kind === 'indexed') throw new Error('PDF import error: Indexed color space cannot use an Indexed base')
    return { kind: 'indexed', base, high: colorSpace.high, lookup: colorSpace.lookup.slice() }
  }
  if (colorSpace.kind === 'separation' || colorSpace.kind === 'deviceN') return specialColorSpaceDef(doc, colorSpace)
  return processColorSpaceDef(colorSpace)
}

export function pdfColorToRgb(doc: PdfDocument, colorSpace: PdfColorSpace, components: number[], intent?: IccRenderingIntent, blackPointCompensation = false, deviceCmykTransform?: IccTransform): [number, number, number] {
  if (colorSpace.kind === 'gray') {
    if (deviceCmykTransform !== undefined) {
      return deviceCmykTransform.toRgb([0, 0, 0, 1 - components[0]!], intent, blackPointCompensation)
    }
    return [components[0]!, components[0]!, components[0]!]
  }
  if (colorSpace.kind === 'rgb') return [components[0]!, components[1]!, components[2]!]
  if (colorSpace.kind === 'cmyk') {
    const c = components[0]!
    const m = components[1]!
    const y = components[2]!
    const k = components[3]!
    if (deviceCmykTransform !== undefined) {
      return deviceCmykTransform.toRgb([c, m, y, k], intent, blackPointCompensation)
    }
    return [1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)]
  }
  if (colorSpace.kind === 'calgray') return calGrayToRgb(colorSpace, components)
  if (colorSpace.kind === 'calrgb') return calRgbToRgb(colorSpace, components)
  if (colorSpace.kind === 'lab') return labToRgb(colorSpace, components)
  if (colorSpace.kind === 'icc') {
    const normalized = new Array<number>(colorSpace.transform.components)
    for (let i = 0; i < normalized.length; i++) {
      const minimum = colorSpace.range[i * 2]!
      const maximum = colorSpace.range[i * 2 + 1]!
      const value = components[i]!
      normalized[i] = maximum === minimum ? 0 : (Math.max(minimum, Math.min(maximum, value)) - minimum) / (maximum - minimum)
    }
    return colorSpace.transform.toRgb(normalized, intent, blackPointCompensation)
  }
  if (colorSpace.kind === 'indexed') {
    return indexedToRgb(doc, colorSpace, components[0]!, intent, blackPointCompensation, deviceCmykTransform)
  }
  if (colorSpace.kind === 'separation') {
    const alternate = evaluateTintTransform(doc, colorSpace.tintTransform, [components[0]!])
    assertTintOutputCount(colorSpace.alternate, alternate, 'Separation')
    return pdfColorToRgb(doc, colorSpace.alternate, alternate, intent, blackPointCompensation, deviceCmykTransform)
  }
  if (colorSpace.kind === 'pattern') throw new Error('PDF import error: Pattern color space must be consumed by scn/SCN')
  const alternate = evaluateTintTransform(doc, colorSpace.tintTransform, components)
  assertTintOutputCount(colorSpace.alternate, alternate, 'DeviceN')
  return pdfColorToRgb(doc, colorSpace.alternate, alternate, intent, blackPointCompensation, deviceCmykTransform)
}

function directColorSpaceName(name: string): PdfColorSpace | null {
  if (name === 'DeviceGray' || name === 'G') return { kind: 'gray' }
  if (name === 'DeviceRGB' || name === 'RGB') return { kind: 'rgb' }
  if (name === 'DeviceCMYK' || name === 'CMYK') return { kind: 'cmyk' }
  if (name === 'Pattern') return { kind: 'pattern', base: null }
  return null
}

function parseCalGrayColorSpace(doc: PdfDocument, values: PdfValue[]): PdfColorSpace {
  const dict = colorSpaceDict(doc, values[1] ?? null, 'CalGray')
  return {
    kind: 'calgray',
    whitePoint: requiredWhitePoint(doc, dict, 'CalGray'),
    blackPoint: optionalBlackPoint(doc, dict, 'CalGray'),
    gamma: optionalPositiveNumber(doc, dict, 'Gamma', 1, 'CalGray Gamma'),
  }
}

function parseCalRgbColorSpace(doc: PdfDocument, values: PdfValue[]): PdfColorSpace {
  const dict = colorSpaceDict(doc, values[1] ?? null, 'CalRGB')
  const gamma = optionalNumberArray(doc, dict, 'Gamma', 'CalRGB') ?? [1, 1, 1]
  if (gamma.length !== 3) throw new Error('PDF import error: CalRGB Gamma must contain three numbers')
  for (let i = 0; i < gamma.length; i++) {
    if (gamma[i]! <= 0) throw new Error('PDF import error: CalRGB Gamma values must be positive')
  }
  const matrix = optionalNumberArray(doc, dict, 'Matrix', 'CalRGB') ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]
  if (matrix.length !== 9) throw new Error('PDF import error: CalRGB Matrix must contain nine numbers')
  return {
    kind: 'calrgb',
    whitePoint: requiredWhitePoint(doc, dict, 'CalRGB'),
    blackPoint: optionalBlackPoint(doc, dict, 'CalRGB'),
    gamma: [gamma[0]!, gamma[1]!, gamma[2]!],
    matrix: [
      matrix[0]!, matrix[1]!, matrix[2]!,
      matrix[3]!, matrix[4]!, matrix[5]!,
      matrix[6]!, matrix[7]!, matrix[8]!,
    ],
  }
}

function colorSpaceDict(doc: PdfDocument, value: PdfValue, label: string): PdfDict {
  const dict = doc.resolve(value)
  if (!(dict instanceof Map)) throw new Error(`PDF import error: ${label} color space requires a dictionary`)
  return dict
}

function requiredWhitePoint(doc: PdfDocument, dict: PdfDict, label: string): [number, number, number] {
  const value = optionalNumberArray(doc, dict, 'WhitePoint', label)
  if (value === null) throw new Error(`PDF import error: ${label} WhitePoint is required`)
  if (value.length !== 3) throw new Error(`PDF import error: ${label} WhitePoint must contain three numbers`)
  if (value[0]! <= 0 || value[2]! <= 0 || value[1] !== 1) {
    throw new Error(`PDF import error: ${label} WhitePoint must have positive X/Z and Y equal to 1`)
  }
  return [value[0]!, value[1]!, value[2]!]
}

function optionalBlackPoint(doc: PdfDocument, dict: PdfDict, label: string): [number, number, number] {
  const value = optionalNumberArray(doc, dict, 'BlackPoint', label) ?? [0, 0, 0]
  if (value.length !== 3) throw new Error(`PDF import error: ${label} BlackPoint must contain three numbers`)
  if (value[0]! < 0 || value[1]! < 0 || value[2]! < 0) throw new Error(`PDF import error: ${label} BlackPoint values must be non-negative`)
  return [value[0]!, value[1]!, value[2]!]
}

function optionalPositiveNumber(doc: PdfDocument, dict: PdfDict, key: string, fallback: number, label: string): number {
  const value = doc.resolve(dict.get(key) ?? null)
  if (value === null) return fallback
  const number = numberValue(value, label)
  if (number <= 0) throw new Error(`PDF import error: ${label} must be positive`)
  return number
}

function parseLabColorSpace(doc: PdfDocument, values: PdfValue[]): PdfColorSpace {
  const dict = colorSpaceDict(doc, values[1] ?? null, 'Lab')
  const whitePoint = requiredWhitePoint(doc, dict, 'Lab')
  let aMin = -100
  let aMax = 100
  let bMin = -100
  let bMax = 100
  const range = doc.resolve(dict.get('Range') ?? null)
  if (Array.isArray(range)) {
    if (range.length !== 4) throw new Error('PDF import error: Lab Range must contain four numbers')
    aMin = numberValue(doc.resolve(range[0]!), 'Lab aMin')
    aMax = numberValue(doc.resolve(range[1]!), 'Lab aMax')
    bMin = numberValue(doc.resolve(range[2]!), 'Lab bMin')
    bMax = numberValue(doc.resolve(range[3]!), 'Lab bMax')
  }
  return { kind: 'lab', whitePoint, blackPoint: optionalBlackPoint(doc, dict, 'Lab'), aMin, aMax, bMin, bMax }
}

function parseIccBasedColorSpace(doc: PdfDocument, values: PdfValue[], resources?: PdfDict | null): PdfColorSpace {
  const profile = doc.resolve(values[1] ?? null)
  if (!(profile instanceof PdfStream)) throw new Error('PDF import error: ICCBased color space profile must be a stream')
  const n = doc.resolve(profile.dict.get('N') ?? null)
  if (n !== 1 && n !== 3 && n !== 4) throw new Error('PDF import error: ICCBased /N must be 1, 3, or 4')
  const range = optionalNumberArray(doc, profile.dict, 'Range', 'ICCBased') ?? defaultIccRange(n)
  if (range.length !== n * 2) throw new Error('PDF import error: ICCBased /Range length must be twice /N')
  for (let i = 0; i < range.length; i += 2) {
    if (range[i]! > range[i + 1]!) throw new Error('PDF import error: ICCBased /Range pairs must be ordered')
  }
  const metadata = doc.resolve(profile.dict.get('Metadata') ?? null)
  if (metadata !== null && !(metadata instanceof PdfStream)) throw new Error('PDF import error: ICCBased /Metadata must be a stream')
  const transform = parseIccProfile(doc.decodeStream(profile))
  if (transform !== null) {
    if (n !== transform.components) {
      throw new Error(`PDF import error: ICCBased /N (${n}) does not match the profile color space (${transform.components})`)
    }
    const permitted = transform.sourceColorSpace === 'GRAY'
      ? n === 1
      : transform.sourceColorSpace === 'RGB' || transform.sourceColorSpace === 'Lab'
        ? n === 3
        : transform.sourceColorSpace === 'CMYK' && n === 4
    if (!permitted) throw new Error(`PDF import error: ICCBased profile color space ${transform.sourceColorSpace} is not permitted for /N ${n}`)
    return { kind: 'icc', transform, range, profile: doc.decodeStream(profile).slice() }
  }
  // ISO 32000-1 8.6.5.5: when the ICC profile cannot be processed, a
  // conforming reader shall use the Alternate color space (or the device
  // space implied by /N when no Alternate is given).
  const alternate = profile.dict.get('Alternate')
  if (alternate !== undefined) {
    const parsed = parsePdfColorSpace(doc, alternate, resources)
    if (parsed.kind === 'pattern' || pdfColorSpaceComponents(parsed) !== n) {
      throw new Error('PDF import error: ICCBased Alternate must be a non-Pattern color space matching /N')
    }
    return parsed
  }
  if (n === 1) return { kind: 'gray' }
  if (n === 3) return { kind: 'rgb' }
  if (n === 4) return { kind: 'cmyk' }
  throw new Error('PDF import error: unsupported ICCBased component count')
}

function defaultIccRange(components: number): number[] {
  const range: number[] = []
  for (let i = 0; i < components; i++) range.push(0, 1)
  return range
}

function parseIndexedColorSpace(doc: PdfDocument, values: PdfValue[], resources?: PdfDict | null): PdfColorSpace {
  if (values.length < 4) throw new Error('PDF import error: Indexed color space requires base, hival, and lookup')
  const base = parsePdfColorSpace(doc, values[1]!, resources)
  if (base.kind === 'indexed') throw new Error('PDF import error: nested Indexed color space is invalid')
  const high = doc.resolve(values[2]!)
  if (typeof high !== 'number' || high < 0 || high > 255) {
    throw new Error('PDF import error: Indexed color space hival must be a number in 0..255')
  }
  const lookupValue = doc.resolve(values[3]!)
  let lookup: Uint8Array
  if (lookupValue instanceof PdfStream) lookup = doc.decodeStream(lookupValue)
  else if (lookupValue instanceof PdfString) lookup = lookupValue.bytes
  else throw new Error('PDF import error: Indexed color space lookup must be a string or stream')
  const baseComponents = pdfColorSpaceComponents(base)
  if (lookup.length < (high + 1) * baseComponents) {
    throw new Error('PDF import error: Indexed color space lookup table is shorter than hival requires')
  }
  return { kind: 'indexed', base, high, lookup }
}

function indexedToRgb(doc: PdfDocument, colorSpace: Extract<PdfColorSpace, { kind: 'indexed' }>, indexValue: number, intent?: IccRenderingIntent, blackPointCompensation = false, deviceCmykTransform?: IccTransform): [number, number, number] {
  const index = Math.max(0, Math.min(colorSpace.high, Math.round(indexValue)))
  const baseComponents = pdfColorSpaceComponents(colorSpace.base)
  const components: number[] = []
  for (let i = 0; i < baseComponents; i++) {
    components.push(colorSpace.lookup[index * baseComponents + i]! / 255)
  }
  return pdfColorToRgb(doc, colorSpace.base, components, intent, blackPointCompensation, deviceCmykTransform)
}

function parseSeparationColorSpace(doc: PdfDocument, values: PdfValue[], resources?: PdfDict | null): PdfColorSpace {
  if (values.length < 4) throw new Error('PDF import error: Separation color space requires name, alternate, and tint transform')
  const name = doc.resolve(values[1]!)
  if (!(name instanceof PdfName)) throw new Error('PDF import error: Separation colorant name must be a name')
  const alternate = parsePdfColorSpace(doc, values[2]!, resources)
  if (!isProcessColorSpace(alternate)) throw new Error('PDF import error: Separation alternate must be a device or CIE-based color space')
  return {
    kind: 'separation',
    name: name.name,
    alternate,
    tintTransform: values[3]!,
  }
}

function parseDeviceNColorSpace(doc: PdfDocument, values: PdfValue[], resources?: PdfDict | null): PdfColorSpace {
  if (values.length < 4) throw new Error('PDF import error: DeviceN color space requires names, alternate, and tint transform')
  const nameValues = doc.resolve(values[1]!)
  if (!Array.isArray(nameValues) || nameValues.length === 0) throw new Error('PDF import error: DeviceN component names must be a non-empty array')
  const names = pdfNameArray(doc, nameValues, 'DeviceN component names')
  if (new Set(names).size !== names.length) throw new Error('PDF import error: DeviceN component names must be unique')
  const alternate = parsePdfColorSpace(doc, values[2]!, resources)
  if (!isProcessColorSpace(alternate)) throw new Error('PDF import error: DeviceN alternate must be a device or CIE-based color space')
  const attributes = values.length > 4
    ? parseDeviceNAttributes(doc, values[4]!, names, resources)
    : null
  return {
    kind: 'deviceN',
    names,
    alternate,
    tintTransform: values[3]!,
    attributes,
  }
}

function parseDeviceNAttributes(
  doc: PdfDocument,
  value: PdfValue,
  names: string[],
  resources?: PdfDict | null,
): PdfDeviceNAttributes {
  const dict = doc.resolve(value)
  if (!(dict instanceof Map)) throw new Error('PDF import error: DeviceN attributes must be a dictionary')
  const subtypeValue = doc.resolve(dict.get('Subtype') ?? null)
  let subtype: 'DeviceN' | 'NChannel' = 'DeviceN'
  if (subtypeValue !== null) {
    if (!(subtypeValue instanceof PdfName) || (subtypeValue.name !== 'DeviceN' && subtypeValue.name !== 'NChannel')) {
      throw new Error('PDF import error: DeviceN Subtype must be /DeviceN or /NChannel')
    }
    subtype = subtypeValue.name
  }

  const colorants = new Map<string, Extract<PdfColorSpace, { kind: 'separation' }>>()
  const colorantsValue = doc.resolve(dict.get('Colorants') ?? null)
  if (colorantsValue !== null) {
    if (!(colorantsValue instanceof Map)) throw new Error('PDF import error: DeviceN Colorants must be a dictionary')
    for (const [name, colorantValue] of colorantsValue) {
      const colorant = parsePdfColorSpace(doc, colorantValue, resources)
      if (colorant.kind !== 'separation') throw new Error(`PDF import error: DeviceN Colorants /${name} must be a Separation color space`)
      if (colorant.name !== name) throw new Error(`PDF import error: DeviceN Colorants /${name} must describe the same colorant name`)
      colorants.set(name, colorant)
    }
  }

  const process = parseDeviceNProcess(doc, dict.get('Process') ?? null, resources)
  const mixingHints = parseDeviceNMixingHints(doc, dict.get('MixingHints') ?? null)
  if (mixingHints !== null && subtype !== 'NChannel') {
    throw new Error('PDF import error: DeviceN MixingHints requires Subtype /NChannel')
  }
  const knownNames = new Set(names)
  if (process !== null) for (let i = 0; i < process.components.length; i++) knownNames.add(process.components[i]!)
  for (const name of colorants.keys()) knownNames.add(name)
  if (mixingHints !== null) {
    validateMixingHintNames(mixingHints.solidities.keys(), knownNames, 'Solidities')
    validateMixingHintNames(mixingHints.printingOrder, knownNames, 'PrintingOrder')
    validateMixingHintNames(mixingHints.dotGain.keys(), knownNames, 'DotGain')
  }
  return { subtype, colorants, process, mixingHints }
}

function parseDeviceNProcess(doc: PdfDocument, value: PdfValue, resources?: PdfDict | null): PdfDeviceNProcess | null {
  const resolved = doc.resolve(value)
  if (resolved === null) return null
  if (!(resolved instanceof Map)) throw new Error('PDF import error: DeviceN Process must be a dictionary')
  const colorSpaceValue = resolved.get('ColorSpace')
  if (colorSpaceValue === undefined) throw new Error('PDF import error: DeviceN Process requires ColorSpace')
  const colorSpace = parsePdfColorSpace(doc, colorSpaceValue, resources)
  if (!isProcessColorSpace(colorSpace)) {
    throw new Error('PDF import error: DeviceN Process ColorSpace must be a process color space')
  }
  const componentValues = doc.resolve(resolved.get('Components') ?? null)
  if (!Array.isArray(componentValues)) throw new Error('PDF import error: DeviceN Process requires a Components array')
  const components = pdfNameArray(doc, componentValues, 'DeviceN Process Components')
  if (components.length !== pdfColorSpaceComponents(colorSpace)) {
    throw new Error('PDF import error: DeviceN Process Components must match its ColorSpace component count')
  }
  return { colorSpace, components }
}

function parseDeviceNMixingHints(doc: PdfDocument, value: PdfValue): PdfDeviceNMixingHints | null {
  const resolved = doc.resolve(value)
  if (resolved === null) return null
  if (!(resolved instanceof Map)) throw new Error('PDF import error: DeviceN MixingHints must be a dictionary')
  const solidities = new Map<string, number>()
  const soliditiesValue = doc.resolve(resolved.get('Solidities') ?? null)
  if (soliditiesValue !== null) {
    if (!(soliditiesValue instanceof Map)) throw new Error('PDF import error: DeviceN Solidities must be a dictionary')
    for (const [name, raw] of soliditiesValue) {
      const solidity = numberValue(doc.resolve(raw), `DeviceN Solidity /${name}`)
      if (solidity < 0 || solidity > 1) throw new Error(`PDF import error: DeviceN Solidity /${name} must be in 0..1`)
      solidities.set(name, solidity)
    }
  }
  const printingOrderValue = doc.resolve(resolved.get('PrintingOrder') ?? null)
  const printingOrder = printingOrderValue === null
    ? []
    : Array.isArray(printingOrderValue)
      ? pdfNameArray(doc, printingOrderValue, 'DeviceN PrintingOrder')
      : (() => { throw new Error('PDF import error: DeviceN PrintingOrder must be an array') })()
  const dotGain = new Map<string, PdfValue>()
  const dotGainValue = doc.resolve(resolved.get('DotGain') ?? null)
  if (dotGainValue !== null) {
    if (!(dotGainValue instanceof Map)) throw new Error('PDF import error: DeviceN DotGain must be a dictionary')
    for (const [name, fn] of dotGainValue) dotGain.set(name, fn)
  }
  return { solidities, printingOrder, dotGain }
}

function pdfNameArray(doc: PdfDocument, values: PdfValue[], label: string): string[] {
  const names: string[] = []
  for (let i = 0; i < values.length; i++) {
    const value = doc.resolve(values[i]!)
    if (!(value instanceof PdfName)) throw new Error(`PDF import error: ${label} must contain only names`)
    names.push(value.name)
  }
  return names
}

function validateMixingHintNames(values: Iterable<string>, knownNames: Set<string>, label: string): void {
  for (const name of values) {
    if (!knownNames.has(name)) throw new Error(`PDF import error: DeviceN ${label} references unknown colorant /${name}`)
  }
}

function assertTintOutputCount(colorSpace: PdfColorSpace, values: number[], label: string): void {
  const expected = pdfColorSpaceComponents(colorSpace)
  if (values.length !== expected) {
    throw new Error(`PDF import error: ${label} tint transform produced ${values.length} components; alternate color space requires ${expected}`)
  }
}

function isProcessColorSpace(colorSpace: PdfColorSpace): colorSpace is Exclude<PdfColorSpace, { kind: 'separation' | 'deviceN' | 'indexed' | 'pattern' }> {
  return colorSpace.kind !== 'separation' && colorSpace.kind !== 'deviceN' && colorSpace.kind !== 'indexed' && colorSpace.kind !== 'pattern'
}

function processColorSpaceDef(colorSpace: Exclude<PdfColorSpace, { kind: 'separation' | 'deviceN' | 'indexed' | 'pattern' }>): PdfProcessColorSpaceDef {
  if (colorSpace.kind === 'gray' || colorSpace.kind === 'rgb' || colorSpace.kind === 'cmyk') return { kind: colorSpace.kind }
  if (colorSpace.kind === 'calgray') return { kind: 'calgray', whitePoint: [...colorSpace.whitePoint], blackPoint: [...colorSpace.blackPoint], gamma: colorSpace.gamma }
  if (colorSpace.kind === 'calrgb') return { kind: 'calrgb', whitePoint: [...colorSpace.whitePoint], blackPoint: [...colorSpace.blackPoint], gamma: [...colorSpace.gamma], matrix: [...colorSpace.matrix] }
  if (colorSpace.kind === 'lab') {
    return { kind: 'lab', whitePoint: [...colorSpace.whitePoint], blackPoint: [...colorSpace.blackPoint], range: [colorSpace.aMin, colorSpace.aMax, colorSpace.bMin, colorSpace.bMax] }
  }
  const components = colorSpace.transform.components
  if (components !== 1 && components !== 3 && components !== 4) throw new Error('PDF import error: ICCBased special-color alternate must have 1, 3, or 4 components')
  return { kind: 'icc', components, range: colorSpace.range.slice(), profile: colorSpace.profile.slice() }
}

function separationColorSpaceDef(doc: PdfDocument, colorSpace: Extract<PdfColorSpace, { kind: 'separation' }>): PdfSeparationColorSpaceDef {
  if (!isProcessColorSpace(colorSpace.alternate)) throw new Error('PDF import error: Separation alternate must be a process color space')
  return {
    kind: 'separation',
    name: colorSpace.name,
    alternate: processColorSpaceDef(colorSpace.alternate),
    tintTransform: readPdfFunctionDef(doc, colorSpace.tintTransform),
  }
}

function specialColorSpaceDef(
  doc: PdfDocument,
  colorSpace: Extract<PdfColorSpace, { kind: 'separation' | 'deviceN' }>,
): PdfSeparationColorSpaceDef | PdfDeviceNColorSpaceDef {
  if (colorSpace.kind === 'separation') return separationColorSpaceDef(doc, colorSpace)
  if (!isProcessColorSpace(colorSpace.alternate)) throw new Error('PDF import error: DeviceN alternate must be a process color space')
  const attributes = colorSpace.attributes
  const colorants: Record<string, PdfSeparationColorSpaceDef> = {}
  if (attributes !== null) {
    for (const [name, separation] of attributes.colorants) colorants[name] = separationColorSpaceDef(doc, separation)
  }
  const process = attributes?.process
  if (process !== null && process !== undefined && !isProcessColorSpace(process.colorSpace)) {
    throw new Error('PDF import error: DeviceN Process ColorSpace must be a process color space')
  }
  const processDef = process === null || process === undefined
    ? undefined
    : { colorSpace: processColorSpaceDef(process.colorSpace as Exclude<PdfColorSpace, { kind: 'separation' | 'deviceN' | 'indexed' | 'pattern' }>), components: process.components.slice() }
  const mixingHints = attributes?.mixingHints
  const solidities: Record<string, number> = {}
  const dotGain: Record<string, ReturnType<typeof readPdfFunctionDef>> = {}
  if (mixingHints !== null && mixingHints !== undefined) {
    for (const [name, solidity] of mixingHints.solidities) solidities[name] = solidity
    for (const [name, fn] of mixingHints.dotGain) dotGain[name] = readPdfFunctionDef(doc, fn)
  }
  return {
    kind: 'deviceN',
    names: colorSpace.names.slice(),
    alternate: processColorSpaceDef(colorSpace.alternate),
    tintTransform: readPdfFunctionDef(doc, colorSpace.tintTransform),
    subtype: attributes?.subtype ?? 'DeviceN',
    colorants,
    ...(processDef === undefined ? {} : { process: processDef }),
    ...(mixingHints === null || mixingHints === undefined ? {} : {
      mixingHints: { solidities, printingOrder: mixingHints.printingOrder.slice(), dotGain },
    }),
  }
}

function parsePatternColorSpace(doc: PdfDocument, values: PdfValue[], resources?: PdfDict | null): PdfColorSpace {
  if (values.length === 1) return { kind: 'pattern', base: null }
  return { kind: 'pattern', base: parsePdfColorSpace(doc, values[1]!, resources) }
}

function evaluateTintTransform(doc: PdfDocument, value: PdfValue, input: number[]): number[] {
  return evaluatePdfFunction(doc, value, input)
}

function optionalNumberArray(doc: PdfDocument, dict: PdfDict, key: string, label = 'tint transform'): number[] | null {
  const value = doc.resolve(dict.get(key) ?? null)
  if (value === null) return null
  if (!Array.isArray(value)) throw new Error(`PDF import error: ${label} /${key} must be an array`)
  const out: number[] = []
  for (let i = 0; i < value.length; i++) out.push(numberValue(doc.resolve(value[i]!), `${label} /${key}`))
  return out
}

function calGrayToRgb(colorSpace: Extract<PdfColorSpace, { kind: 'calgray' }>, components: number[]): [number, number, number] {
  const a = Math.pow(clamp01(components[0]!), colorSpace.gamma)
  return xyzWithWhitePointToSrgb(
    colorSpace.whitePoint[0] * a,
    colorSpace.whitePoint[1] * a,
    colorSpace.whitePoint[2] * a,
    colorSpace.whitePoint,
  )
}

function calRgbToRgb(colorSpace: Extract<PdfColorSpace, { kind: 'calrgb' }>, components: number[]): [number, number, number] {
  const a = Math.pow(clamp01(components[0]!), colorSpace.gamma[0])
  const b = Math.pow(clamp01(components[1]!), colorSpace.gamma[1])
  const c = Math.pow(clamp01(components[2]!), colorSpace.gamma[2])
  const m = colorSpace.matrix
  return xyzWithWhitePointToSrgb(
    m[0] * a + m[3] * b + m[6] * c,
    m[1] * a + m[4] * b + m[7] * c,
    m[2] * a + m[5] * b + m[8] * c,
    colorSpace.whitePoint,
  )
}

function labToRgb(colorSpace: Extract<PdfColorSpace, { kind: 'lab' }>, components: number[]): [number, number, number] {
  const l = components[0]! * 100
  const a = colorSpace.aMin + components[1]! * (colorSpace.aMax - colorSpace.aMin)
  const b = colorSpace.bMin + components[2]! * (colorSpace.bMax - colorSpace.bMin)
  const fy = (l + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const x = colorSpace.whitePoint[0] * labInv(fx)
  const y = colorSpace.whitePoint[1] * labInv(fy)
  const z = colorSpace.whitePoint[2] * labInv(fz)
  return xyzWithWhitePointToSrgb(x, y, z, colorSpace.whitePoint)
}

function labInv(t: number): number {
  const t3 = t * t * t
  return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function numberValue(value: PdfValue, label: string): number {
  if (typeof value !== 'number') throw new Error(`PDF import error: ${label} must be a number`)
  return value
}

function byteHex(v: number): string {
  const n = Math.max(0, Math.min(255, Math.round(v * 255)))
  return n.toString(16).padStart(2, '0')
}
