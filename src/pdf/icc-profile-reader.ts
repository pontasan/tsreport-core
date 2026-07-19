/**
 * ICC profile reader for ICCBased color spaces (ISO 15076-1 / ICC.1).
 *
 * Interprets the embedded profile instead of approximating by component
 * count: gray TRC profiles, RGB matrix-TRC profiles, and N-component LUT
 * profiles (mft1/mft2 and the v4 lutAtoBType) all transform device values
 * through the profile to the PCS and then to sRGB.
 *
 * Per ISO 32000-1 8.6.5.5, a conforming reader uses the Alternate color
 * space when the ICC profile cannot be processed; parseIccProfile therefore
 * returns null for profile CLASSES this reader does not model (device link,
 * named color) or when the required transform tags are absent, while
 * structurally corrupt data still throws.
 */

export interface IccTransform {
  /** Number of device components the transform consumes */
  components: number
  /** ICC data color-space signature without its padding byte. */
  sourceColorSpace: string
  /** Transforms device components (0..1 each) to PCSXYZ (D50). */
  toXyz(components: number[], intent?: IccRenderingIntent): [number, number, number]
  /** Transforms device components (0..1 each) to sRGB (0..1 each). */
  toRgb(components: number[], intent?: IccRenderingIntent, blackPointCompensation?: boolean): [number, number, number]
}

/** ICC output-profile transform from the D50 PCS to device components. */
export interface IccOutputTransform {
  /** Number of destination device components produced by the transform. */
  components: number
  /** ICC destination data color-space signature without padding. */
  destinationColorSpace: string
  /** Transforms PCSXYZ (D50) values to destination device components. */
  fromXyz(xyz: readonly [number, number, number], intent?: IccRenderingIntent): number[]
  /** Transforms encoded sRGB values to destination device components. */
  fromRgb(rgb: readonly [number, number, number], intent?: IccRenderingIntent): number[]
}

export type IccRenderingIntent = 'AbsoluteColorimetric' | 'RelativeColorimetric' | 'Saturation' | 'Perceptual'

export type IccProfileClass = 'input' | 'display' | 'output' | 'deviceLink' | 'colorSpace' | 'abstract' | 'namedColor'

export interface IccProfileHeader {
  size: number
  versionMajor: number
  versionMinor: number
  profileClass: IccProfileClass
  dataColorSpace: string
  connectionSpace: string
  components: number | null
  renderingIntent: IccRenderingIntent
  illuminant: readonly [number, number, number]
}

import { D50_WHITE, srgbToXyzWithWhitePoint, xyzWithWhitePointToSrgb } from './xyz-color.js'

/**
 * Raised while reading a profile that cannot be processed as ICC data.
 * ISO 32000-1 8.6.5.5 prescribes the Alternate color space for exactly this
 * case, so parseIccProfile converts THIS error type (and only this type) to
 * a null return — a typed control flow for the spec-mandated path, not a
 * blanket exception swallow.
 */
class IccUnprocessableError extends Error {}

interface TagEntry {
  offset: number
  size: number
}

interface IccPcsTransform extends IccTransform {}

interface IccDeviceTransform {
  fromXyz(xyz: readonly [number, number, number]): number[]
}

/** One-dimensional tone curve (identity / gamma / sampled / parametric). */
type Curve = (value: number) => number

const PCS_XYZ = 0x58595A20 // 'XYZ '
const PCS_LAB = 0x4C616220 // 'Lab '

export function parseIccProfile(data: Uint8Array): IccTransform | null {
  try {
    return parseIccProfileStrict(data)
  } catch (e) {
    if (e instanceof IccUnprocessableError) return null
    throw e
  }
}

/**
 * Parses the normative PCS-to-device transform of an ICC output profile.
 * A profile without a usable B2A transform is rejected; output conversion
 * never switches to an unrelated component formula.
 */
export function parseIccOutputProfile(data: Uint8Array): IccOutputTransform {
  const header = inspectIccProfile(data)
  if (header.profileClass !== 'output') throw new Error('ICC destination profile must have output device class')
  if (header.components === null) throw new Error('ICC destination profile has an unknown device color space')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const pcs = view.getUint32(20)
  if (pcs !== PCS_XYZ && pcs !== PCS_LAB) throw new Error('ICC destination profile PCS must be XYZ or Lab')
  const tags = readTagTable(view, data)
  const transforms = new Map<string, IccDeviceTransform>()
  for (const tag of ['B2A0', 'B2A1', 'B2A2']) {
    const entry = tags.get(tag)
    if (entry === undefined) continue
    const transform = parseDeviceLutTag(view, data, entry, header.components, pcs)
    if (transform !== null) transforms.set(tag, transform)
  }
  if (transforms.size === 0) throw new Error('ICC output profile requires a supported B2A0, B2A1, or B2A2 transform')
  const first = transforms.get('B2A0') ?? transforms.get('B2A1') ?? transforms.get('B2A2')!
  const whitePointEntry = tags.get('wtpt')
  const mediaWhitePoint = whitePointEntry === undefined ? D50_WHITE : readXyzTag(view, whitePointEntry)
  const transformForIntent = function (intent: IccRenderingIntent): IccDeviceTransform {
    const preferred = intent === 'Perceptual' ? 'B2A0'
      : intent === 'Saturation' ? 'B2A2'
        : 'B2A1'
    return transforms.get(preferred) ?? first
  }
  return {
    components: header.components,
    destinationColorSpace: header.dataColorSpace,
    fromXyz(xyz: readonly [number, number, number], intent: IccRenderingIntent = 'RelativeColorimetric'): number[] {
      const relative: [number, number, number] = intent === 'AbsoluteColorimetric'
        ? [
            xyz[0] * D50_WHITE[0] / mediaWhitePoint[0],
            xyz[1] * D50_WHITE[1] / mediaWhitePoint[1],
            xyz[2] * D50_WHITE[2] / mediaWhitePoint[2],
          ]
        : [xyz[0], xyz[1], xyz[2]]
      return transformForIntent(intent).fromXyz(relative)
    },
    fromRgb(rgb: readonly [number, number, number], intent: IccRenderingIntent = 'RelativeColorimetric'): number[] {
      return this.fromXyz(srgbToXyzWithWhitePoint(rgb[0], rgb[1], rgb[2], D50_WHITE), intent)
    },
  }
}

/** Validates and exposes the normative ICC profile header and tag directory. */
export function inspectIccProfile(data: Uint8Array): IccProfileHeader {
  if (data.length < 132) throw new IccUnprocessableError('ICC profile is too small')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const size = view.getUint32(0)
  if (size !== data.length) throw new IccUnprocessableError('ICC profile size does not match the profile data')
  const versionMajor = data[8]!
  const versionMinor = data[9]! >> 4
  if (versionMajor !== 2 && versionMajor !== 4) throw new IccUnprocessableError(`ICC profile version ${versionMajor}.${versionMinor} is not supported by ICC.1`)
  if (view.getUint32(36) !== 0x61637370) throw new IccUnprocessableError('ICC profile signature must be acsp')
  const profileClass = profileClassForSignature(view.getUint32(12))
  if (profileClass === null) throw new IccUnprocessableError('ICC profile class signature is invalid')
  const colorSpaceSignature = view.getUint32(16)
  const connectionSpaceSignature = view.getUint32(20)
  const dataColorSpace = signatureText(colorSpaceSignature).trimEnd()
  const connectionSpace = signatureText(connectionSpaceSignature).trimEnd()
  const components = componentCountForSignature(colorSpaceSignature)
  if (components === null && !isThreeComponentIccSpace(colorSpaceSignature)) {
    throw new IccUnprocessableError(`ICC data color space ${dataColorSpace} is invalid`)
  }
  if (connectionSpaceSignature !== PCS_XYZ && connectionSpaceSignature !== PCS_LAB
    && profileClass !== 'deviceLink') {
    throw new IccUnprocessableError(`ICC profile connection space ${connectionSpace} is invalid`)
  }
  const intentValue = view.getUint32(64)
  const intents: readonly IccRenderingIntent[] = ['Perceptual', 'RelativeColorimetric', 'Saturation', 'AbsoluteColorimetric']
  if (intentValue >= intents.length) throw new IccUnprocessableError(`ICC rendering intent ${intentValue} is invalid`)
  for (let position = 100; position < 128; position++) {
    if (data[position] !== 0) throw new IccUnprocessableError('ICC reserved header bytes must be zero')
  }
  readTagTable(view, data)
  return {
    size,
    versionMajor,
    versionMinor,
    profileClass,
    dataColorSpace,
    connectionSpace,
    components: components ?? 3,
    renderingIntent: intents[intentValue]!,
    illuminant: [view.getInt32(68) / 65536, view.getInt32(72) / 65536, view.getInt32(76) / 65536],
  }
}

function parseIccProfileStrict(data: Uint8Array): IccTransform | null {
  inspectIccProfile(data)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const deviceClass = view.getUint32(12)
  const colorSpace = view.getUint32(16)
  const pcs = view.getUint32(20)

  // Only input/display/output/colorspace classes model a device->PCS
  // transform this reader consumes ('scnr' 'mntr' 'prtr' 'spac').
  if (deviceClass !== 0x73636E72 && deviceClass !== 0x6D6E7472 && deviceClass !== 0x70727472 && deviceClass !== 0x73706163) {
    return null
  }
  if (pcs !== PCS_XYZ && pcs !== PCS_LAB) return null
  const components = componentCountForSignature(colorSpace)
  if (components === null) return null
  const sourceColorSpace = signatureText(colorSpace).trimEnd()

  const tags = readTagTable(view, data)
  const whitePointEntry = tags.get('wtpt')
  const mediaWhitePoint = whitePointEntry === undefined ? D50_WHITE : readXyzTag(view, whitePointEntry)

  // LUT intents are distinct transforms: A2B0 = perceptual, A2B1 =
  // media-relative colorimetric, A2B2 = saturation. Absolute colorimetric
  // uses the colorimetric transform; media-white scaling is applied by the
  // color-management stage that owns the destination profile.
  const lutTransforms = new Map<string, IccPcsTransform>()
  for (const tag of ['A2B0', 'A2B1', 'A2B2']) {
    const entry = tags.get(tag)
    if (entry !== undefined) {
      const lut = parseLutTag(view, data, entry, components, pcs)
      if (lut !== null) lutTransforms.set(tag, lut)
    }
  }
  if (lutTransforms.size > 0) return intentAwareLutTransform(components, sourceColorSpace, lutTransforms, mediaWhitePoint)

  // RGB matrix-TRC profile
  if (components === 3) {
    const matrixTrc = parseMatrixTrcProfile(view, data, tags)
    if (matrixTrc !== null) return matrixTrc
  }

  // Gray TRC profile
  if (components === 1) {
    const grayEntry = tags.get('kTRC')
    if (grayEntry !== undefined) {
      const curve = parseCurveAt(view, data, grayEntry.offset, grayEntry.offset + grayEntry.size)
      const transform: IccPcsTransform = {
        components: 1,
        sourceColorSpace: 'GRAY',
        toXyz(values: number[]): [number, number, number] {
          // Gray TRC yields the achromatic Y; PCS white is D50
          const y = curve(clamp01(values[0]!))
          return [0.9642 * y, y, 0.8249 * y]
        },
        toRgb(values: number[]): [number, number, number] {
          const xyz = this.toXyz(values)
          return xyzD50ToSrgb(xyz[0], xyz[1], xyz[2])
        },
      }
      return transform
    }
  }

  // Profile is structurally valid but carries no transform this reader
  // models; ISO 32000 prescribes the Alternate color space in that case.
  return null
}

function intentAwareLutTransform(
  components: number,
  sourceColorSpace: string,
  transforms: Map<string, IccPcsTransform>,
  mediaWhitePoint: readonly [number, number, number],
): IccTransform {
  const first = transforms.get('A2B0') ?? transforms.get('A2B1') ?? transforms.get('A2B2')!
  const transformForIntent = function (intent: IccRenderingIntent): IccPcsTransform {
    const preferred = intent === 'Perceptual' ? 'A2B0'
      : intent === 'Saturation' ? 'A2B2'
        : 'A2B1'
    return transforms.get(preferred) ?? first
  }
  return {
    components,
    sourceColorSpace,
    toXyz(values: number[], intent: IccRenderingIntent = 'RelativeColorimetric'): [number, number, number] {
      const xyz = transformForIntent(intent).toXyz(values)
      if (intent !== 'AbsoluteColorimetric') return xyz
      return [
        xyz[0] * mediaWhitePoint[0] / D50_WHITE[0],
        xyz[1] * mediaWhitePoint[1] / D50_WHITE[1],
        xyz[2] * mediaWhitePoint[2] / D50_WHITE[2],
      ]
    },
    toRgb(values: number[], intent: IccRenderingIntent = 'RelativeColorimetric', blackPointCompensation = false): [number, number, number] {
      let xyz = this.toXyz(values, intent)
      if (blackPointCompensation && intent !== 'AbsoluteColorimetric') {
        xyz = applyBlackPointCompensation(xyz, sourceBlackPoint(this, intent))
      }
      return xyzD50ToSrgb(xyz[0], xyz[1], xyz[2])
    },
  }
}

/**
 * Applies the ISO 18619 PCSXYZ mapping to the sRGB destination profile. The
 * destination black is zero; source black is derived from the darkest device
 * vertex through the selected source-profile transform.
 */
function applyBlackPointCompensation(
  xyz: [number, number, number],
  sourceBlack: [number, number, number],
): [number, number, number] {
  const sourceL = Math.min(50, xyzYToLabL(sourceBlack[1]))
  const sourceY = labLToXyzY(sourceL)
  if (sourceY <= 0) return xyz
  const scale = 1 / (1 - sourceY)
  return [
    scale * xyz[0] + (1 - scale) * D50_WHITE[0],
    scale * xyz[1] + (1 - scale) * D50_WHITE[1],
    scale * xyz[2] + (1 - scale) * D50_WHITE[2],
  ]
}

function sourceBlackPoint(transform: IccTransform, intent: IccRenderingIntent): [number, number, number] {
  const vertices = darkestDeviceVertices(transform.sourceColorSpace)
  let darkest = transform.toXyz(vertices[0]!, intent)
  let darkestL = xyzYToLabL(darkest[1])
  for (let i = 1; i < vertices.length; i++) {
    const candidate = transform.toXyz(vertices[i]!, intent)
    const candidateL = xyzYToLabL(candidate[1])
    if (candidateL < darkestL) {
      darkest = candidate
      darkestL = candidateL
    }
  }
  return darkest
}

function darkestDeviceVertices(colorSpace: string): number[][] {
  if (colorSpace === 'GRAY') return [[0], [1]]
  if (colorSpace === 'RGB') return [[0, 0, 0], [1, 1, 1]]
  if (colorSpace === 'CMYK') return [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 1], [1, 1, 1, 0]]
  if (colorSpace === 'Lab') return [[0, 0.5, 0.5]]
  throw new Error(`Black-point compensation does not support ICC ${colorSpace} device space`)
}

function xyzYToLabL(y: number): number {
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : y * 24389 / 27
}

function labLToXyzY(l: number): number {
  return l > 8 ? Math.pow((l + 16) / 116, 3) : l * Math.pow(24 / 116, 3) / 8
}

function componentCountForSignature(signature: number): number | null {
  switch (signature) {
    case 0x47524159: return 1 // 'GRAY'
    case 0x52474220: return 3 // 'RGB '
    case 0x434D594B: return 4 // 'CMYK'
    case 0x4C616220: return 3 // 'Lab '
    case 0x32434C52: return 2 // '2CLR'
    case 0x33434C52: return 3 // '3CLR'
    case 0x34434C52: return 4 // '4CLR'
    case 0x35434C52: return 5 // '5CLR'
    case 0x36434C52: return 6 // '6CLR'
    case 0x37434C52: return 7 // '7CLR'
    case 0x38434C52: return 8 // '8CLR'
    case 0x39434C52: return 9 // '9CLR'
    case 0x41434C52: return 10 // 'ACLR'
    case 0x42434C52: return 11 // 'BCLR'
    case 0x43434C52: return 12 // 'CCLR'
    case 0x44434C52: return 13 // 'DCLR'
    case 0x45434C52: return 14 // 'ECLR'
    case 0x46434C52: return 15 // 'FCLR'
    default: return null
  }
}

function isThreeComponentIccSpace(signature: number): boolean {
  return signature === 0x58595A20 // XYZ
    || signature === 0x4C757620 // Luv
    || signature === 0x59436272 // YCbr
    || signature === 0x59787920 // Yxy
    || signature === 0x48535620 // HSV
    || signature === 0x484C5320 // HLS
    || signature === 0x434D5920 // CMY
}

function profileClassForSignature(signature: number): IccProfileClass | null {
  switch (signature) {
    case 0x73636E72: return 'input' // scnr
    case 0x6D6E7472: return 'display' // mntr
    case 0x70727472: return 'output' // prtr
    case 0x6C696E6B: return 'deviceLink' // link
    case 0x73706163: return 'colorSpace' // spac
    case 0x61627374: return 'abstract' // abst
    case 0x6E6D636C: return 'namedColor' // nmcl
    default: return null
  }
}

function signatureText(signature: number): string {
  return String.fromCharCode(signature >>> 24, (signature >>> 16) & 0xff, (signature >>> 8) & 0xff, signature & 0xff)
}

function readTagTable(view: DataView, data: Uint8Array): Map<string, TagEntry> {
  const count = view.getUint32(128)
  if (132 + count * 12 > data.length) throw new IccUnprocessableError('ICC tag table exceeds the profile size')
  const tags = new Map<string, TagEntry>()
  for (let i = 0; i < count; i++) {
    const base = 132 + i * 12
    const sig = String.fromCharCode(data[base]!, data[base + 1]!, data[base + 2]!, data[base + 3]!)
    const offset = view.getUint32(base + 4)
    const size = view.getUint32(base + 8)
    if (offset + size > data.length) throw new IccUnprocessableError(`ICC tag ${sig} exceeds the profile size`)
    tags.set(sig, { offset, size })
  }
  return tags
}

// ─── Matrix-TRC (RGB) profiles ───

function parseMatrixTrcProfile(view: DataView, data: Uint8Array, tags: Map<string, TagEntry>): IccPcsTransform | null {
  const rXyz = tags.get('rXYZ')
  const gXyz = tags.get('gXYZ')
  const bXyz = tags.get('bXYZ')
  const rTrc = tags.get('rTRC')
  const gTrc = tags.get('gTRC')
  const bTrc = tags.get('bTRC')
  if (rXyz === undefined || gXyz === undefined || bXyz === undefined
    || rTrc === undefined || gTrc === undefined || bTrc === undefined) {
    return null
  }
  const red = readXyzTag(view, rXyz)
  const green = readXyzTag(view, gXyz)
  const blue = readXyzTag(view, bXyz)
  const curves: [Curve, Curve, Curve] = [
    parseCurveAt(view, data, rTrc.offset, rTrc.offset + rTrc.size),
    parseCurveAt(view, data, gTrc.offset, gTrc.offset + gTrc.size),
    parseCurveAt(view, data, bTrc.offset, bTrc.offset + bTrc.size),
  ]
  return {
    components: 3,
    sourceColorSpace: 'RGB',
    toXyz(values: number[]): [number, number, number] {
      const lr = curves[0](clamp01(values[0]!))
      const lg = curves[1](clamp01(values[1]!))
      const lb = curves[2](clamp01(values[2]!))
      const x = red[0] * lr + green[0] * lg + blue[0] * lb
      const y = red[1] * lr + green[1] * lg + blue[1] * lb
      const z = red[2] * lr + green[2] * lg + blue[2] * lb
      return [x, y, z]
    },
    toRgb(values: number[]): [number, number, number] {
      const xyz = this.toXyz(values)
      return xyzD50ToSrgb(xyz[0], xyz[1], xyz[2])
    },
  }
}

function readXyzTag(view: DataView, entry: TagEntry): [number, number, number] {
  if (entry.size < 20) throw new IccUnprocessableError('ICC XYZ tag is too small')
  const type = view.getUint32(entry.offset)
  if (type !== 0x58595A20) throw new IccUnprocessableError('ICC XYZ tag has an unexpected type')
  return [
    view.getInt32(entry.offset + 8) / 65536,
    view.getInt32(entry.offset + 12) / 65536,
    view.getInt32(entry.offset + 16) / 65536,
  ]
}

// ─── Tone curves (curv / para) ───

function parseCurveAt(view: DataView, data: Uint8Array, offset: number, end: number): Curve {
  const type = view.getUint32(offset)
  if (type === 0x63757276) { // 'curv'
    const count = view.getUint32(offset + 8)
    if (count === 0) return identityCurve
    if (count === 1) {
      const gamma = view.getUint16(offset + 12) / 256
      return function (value: number): number { return Math.pow(clamp01(value), gamma) }
    }
    if (offset + 12 + count * 2 > end) throw new IccUnprocessableError('ICC curv table exceeds the tag size')
    const table = new Float64Array(count)
    for (let i = 0; i < count; i++) table[i] = view.getUint16(offset + 12 + i * 2) / 65535
    return function (value: number): number { return interpolateTable(table, clamp01(value)) }
  }
  if (type === 0x70617261) { // 'para' (parametricCurveType)
    const funcType = view.getUint16(offset + 8)
    const paramCount = [1, 3, 4, 5, 7][funcType]
    if (paramCount === undefined) throw new IccUnprocessableError(`ICC parametric curve type ${funcType} is invalid`)
    if (offset + 12 + paramCount * 4 > end) throw new IccUnprocessableError('ICC para tag exceeds the tag size')
    const p: number[] = []
    for (let i = 0; i < paramCount; i++) p.push(view.getInt32(offset + 12 + i * 4) / 65536)
    return buildParametricCurve(funcType, p)
  }
  throw new IccUnprocessableError('ICC tone curve has an unexpected type')
}

function buildParametricCurve(funcType: number, p: number[]): Curve {
  // ICC.1 parametricCurveType function types 0-4
  const g = p[0]!
  if (funcType === 0) {
    return function (x: number): number { return Math.pow(clamp01(x), g) }
  }
  if (funcType === 1) {
    const a = p[1]!
    const b = p[2]!
    return function (x: number): number {
      const v = clamp01(x)
      return v >= -b / a ? Math.pow(a * v + b, g) : 0
    }
  }
  if (funcType === 2) {
    const a = p[1]!
    const b = p[2]!
    const c = p[3]!
    return function (x: number): number {
      const v = clamp01(x)
      return v >= -b / a ? Math.pow(a * v + b, g) + c : c
    }
  }
  if (funcType === 3) {
    const a = p[1]!
    const b = p[2]!
    const c = p[3]!
    const d = p[4]!
    return function (x: number): number {
      const v = clamp01(x)
      return v >= d ? Math.pow(a * v + b, g) : c * v
    }
  }
  const a = p[1]!
  const b = p[2]!
  const c = p[3]!
  const d = p[4]!
  const e = p[5]!
  const f = p[6]!
  return function (x: number): number {
    const v = clamp01(x)
    return v >= d ? Math.pow(a * v + b, g) + e : c * v + f
  }
}

const identityCurve: Curve = function (value: number): number { return clamp01(value) }

function interpolateTable(table: Float64Array, value: number): number {
  const position = value * (table.length - 1)
  const index = Math.floor(position)
  if (index >= table.length - 1) return table[table.length - 1]!
  const fraction = position - index
  return table[index]! * (1 - fraction) + table[index + 1]! * fraction
}

// ─── LUT transforms (mft1 / mft2 / mAB) ───

function parseLutTag(view: DataView, data: Uint8Array, entry: TagEntry, components: number, pcs: number): IccPcsTransform | null {
  const type = view.getUint32(entry.offset)
  if (type === 0x6D667431) return parseMftTag(view, data, entry, components, pcs, 1)  // 'mft1'
  if (type === 0x6D667432) return parseMftTag(view, data, entry, components, pcs, 2)  // 'mft2'
  if (type === 0x6D414220) return parseMabTag(view, data, entry, components, pcs)     // 'mAB '
  return null
}

function parseDeviceLutTag(
  view: DataView,
  data: Uint8Array,
  entry: TagEntry,
  components: number,
  pcs: number,
): IccDeviceTransform | null {
  const type = view.getUint32(entry.offset)
  if (type === 0x6D667431) return parseDeviceMftTag(view, data, entry, components, pcs, 1) // 'mft1'
  if (type === 0x6D667432) return parseDeviceMftTag(view, data, entry, components, pcs, 2) // 'mft2'
  if (type === 0x6D424120) return parseMbaTag(view, data, entry, components, pcs) // 'mBA '
  return null
}

/** lut8Type/lut16Type BToA pipeline: input tables, optional XYZ matrix, CLUT, output tables. */
function parseDeviceMftTag(
  view: DataView,
  data: Uint8Array,
  entry: TagEntry,
  components: number,
  pcs: number,
  variant: 1 | 2,
): IccDeviceTransform {
  const offset = entry.offset
  const inputChannels = data[offset + 8]!
  const outputChannels = data[offset + 9]!
  const gridPoints = data[offset + 10]!
  if (inputChannels !== 3) throw new IccUnprocessableError('ICC B2A LUT must consume three PCS channels')
  if (outputChannels !== components) {
    throw new IccUnprocessableError(`ICC B2A LUT output channels (${outputChannels}) do not match the device space (${components})`)
  }
  if (gridPoints < 2) throw new IccUnprocessableError('ICC B2A LUT requires at least two grid points per input')

  const matrix: number[] = []
  for (let i = 0; i < 9; i++) matrix.push(view.getInt32(offset + 12 + i * 4) / 65536)
  if (pcs === PCS_LAB) {
    for (let i = 0; i < 9; i++) {
      const expected = i % 4 === 0 ? 1 : 0
      if (Math.abs(matrix[i]! - expected) > 1e-4) {
        throw new IccUnprocessableError('ICC Lab B2A LUT matrix must be identity')
      }
    }
  }

  let inputEntries: number
  let outputEntries: number
  let cursor: number
  if (variant === 1) {
    inputEntries = 256
    outputEntries = 256
    cursor = offset + 48
  } else {
    inputEntries = view.getUint16(offset + 48)
    outputEntries = view.getUint16(offset + 50)
    if (inputEntries < 2 || outputEntries < 2) throw new IccUnprocessableError('ICC mft2 table entry counts must be at least 2')
    cursor = offset + 52
  }
  const readValue = variant === 1
    ? function (at: number): number { return data[at]! / 255 }
    : function (at: number): number { return view.getUint16(at) / 65535 }
  const valueSize = variant === 1 ? 1 : 2
  const inputTables: Float64Array[] = []
  for (let channel = 0; channel < inputChannels; channel++) {
    const table = new Float64Array(inputEntries)
    for (let i = 0; i < inputEntries; i++) {
      table[i] = readValue(cursor)
      cursor += valueSize
    }
    inputTables.push(table)
  }
  const clutSize = Math.pow(gridPoints, inputChannels) * outputChannels
  const clutBase = cursor
  cursor += clutSize * valueSize
  const outputTables: Float64Array[] = []
  for (let channel = 0; channel < outputChannels; channel++) {
    const table = new Float64Array(outputEntries)
    for (let i = 0; i < outputEntries; i++) {
      table[i] = readValue(cursor)
      cursor += valueSize
    }
    outputTables.push(table)
  }
  if (cursor > entry.offset + entry.size) throw new IccUnprocessableError('ICC B2A LUT data exceeds the tag size')
  const clutLookup = function (at: number): number { return readValue(clutBase + at * valueSize) }
  return {
    fromXyz(xyz: readonly [number, number, number]): number[] {
      const encoded = encodePcsXyz(xyz, pcs, variant)
      let stage = encoded.map(function (value, channel) {
        return interpolateTable(inputTables[channel]!, clamp01(value))
      })
      if (pcs === PCS_XYZ) {
        const x = stage[0]!
        const y = stage[1]!
        const z = stage[2]!
        stage = [
          matrix[0]! * x + matrix[1]! * y + matrix[2]! * z,
          matrix[3]! * x + matrix[4]! * y + matrix[5]! * z,
          matrix[6]! * x + matrix[7]! * y + matrix[8]! * z,
        ]
      }
      const device = sampleClut(stage, gridPoints, outputChannels, clutLookup)
      for (let channel = 0; channel < outputChannels; channel++) {
        device[channel] = interpolateTable(outputTables[channel]!, clamp01(device[channel]!))
      }
      return device
    },
  }
}

/** v4 lutBtoAType: B-curves, matrix, M-curves, CLUT, then A-curves. */
function parseMbaTag(
  view: DataView,
  data: Uint8Array,
  entry: TagEntry,
  components: number,
  pcs: number,
): IccDeviceTransform {
  const offset = entry.offset
  const inputChannels = data[offset + 8]!
  const outputChannels = data[offset + 9]!
  if (inputChannels !== 3) throw new IccUnprocessableError('ICC mBA transform must consume three PCS channels')
  if (outputChannels !== components) throw new IccUnprocessableError('ICC mBA output channels do not match the device space')
  const bCurvesOffset = view.getUint32(offset + 12)
  const matrixOffset = view.getUint32(offset + 16)
  const mCurvesOffset = view.getUint32(offset + 20)
  const clutOffset = view.getUint32(offset + 24)
  const aCurvesOffset = view.getUint32(offset + 28)
  const end = entry.offset + entry.size
  if (bCurvesOffset === 0) throw new IccUnprocessableError('ICC mBA transform requires B curves')
  const bCurves = readCurveSet(view, data, offset + bCurvesOffset, end, inputChannels)
  const mCurves = mCurvesOffset === 0 ? null : readCurveSet(view, data, offset + mCurvesOffset, end, inputChannels)
  const aCurves = aCurvesOffset === 0 ? null : readCurveSet(view, data, offset + aCurvesOffset, end, outputChannels)
  let matrix: number[] | null = null
  if (matrixOffset !== 0) {
    matrix = []
    for (let i = 0; i < 12; i++) matrix.push(view.getInt32(offset + matrixOffset + i * 4) / 65536)
  }
  let clut: { gridPoints: number[], lookup: (at: number) => number } | null = null
  if (clutOffset !== 0) {
    const base = offset + clutOffset
    const gridPoints: number[] = []
    for (let i = 0; i < inputChannels; i++) {
      const points = data[base + i]!
      if (points < 2) throw new IccUnprocessableError('ICC mBA CLUT requires at least two grid points per input')
      gridPoints.push(points)
    }
    const precision = data[base + 16]!
    if (precision !== 1 && precision !== 2) throw new IccUnprocessableError(`ICC mBA CLUT precision ${precision} is invalid`)
    const dataBase = base + 20
    const lookup = precision === 1
      ? function (at: number): number { return data[dataBase + at]! / 255 }
      : function (at: number): number { return view.getUint16(dataBase + at * 2) / 65535 }
    clut = { gridPoints, lookup }
  } else if (inputChannels !== outputChannels) {
    throw new IccUnprocessableError('ICC mBA without a CLUT requires matching channel counts')
  }
  return {
    fromXyz(xyz: readonly [number, number, number]): number[] {
      let stage = encodePcsXyz(xyz, pcs, 4)
      for (let channel = 0; channel < stage.length; channel++) stage[channel] = bCurves[channel]!(clamp01(stage[channel]!))
      if (matrix !== null) {
        const x = stage[0]!
        const y = stage[1]!
        const z = stage[2]!
        stage = [
          matrix[0]! * x + matrix[1]! * y + matrix[2]! * z + matrix[9]!,
          matrix[3]! * x + matrix[4]! * y + matrix[5]! * z + matrix[10]!,
          matrix[6]! * x + matrix[7]! * y + matrix[8]! * z + matrix[11]!,
        ]
      }
      if (mCurves !== null) {
        for (let channel = 0; channel < stage.length; channel++) stage[channel] = mCurves[channel]!(clamp01(stage[channel]!))
      }
      if (clut !== null) stage = sampleClutNonUniform(stage, clut.gridPoints, outputChannels, clut.lookup)
      if (aCurves !== null) {
        for (let channel = 0; channel < stage.length; channel++) stage[channel] = aCurves[channel]!(clamp01(stage[channel]!))
      }
      return stage.map(clamp01)
    },
  }
}

function parseMftTag(view: DataView, data: Uint8Array, entry: TagEntry, components: number, pcs: number, variant: 1 | 2): IccPcsTransform | null {
  const offset = entry.offset
  const inputChannels = data[offset + 8]!
  const outputChannels = data[offset + 9]!
  const gridPoints = data[offset + 10]!
  if (inputChannels !== components) {
    throw new IccUnprocessableError(`ICC LUT input channels (${inputChannels}) do not match the color space (${components})`)
  }
  if (outputChannels !== 3) return null // PCS is always 3 components; anything else is not a device->PCS LUT
  if (gridPoints < 2) throw new IccUnprocessableError('ICC LUT requires at least two grid points per input')

  // 3x3 matrix (s15Fixed16); per ICC.1 it applies only when the LUT input is
  // PCSXYZ, which never holds for a device->PCS (A2B) transform — require
  // identity so a non-conforming profile fails loudly instead of silently.
  const matrixBase = offset + 12
  for (let i = 0; i < 9; i++) {
    const value = view.getInt32(matrixBase + i * 4) / 65536
    const expected = i % 4 === 0 ? 1 : 0
    if (Math.abs(value - expected) > 1e-4) {
      throw new IccUnprocessableError('ICC device LUT with a non-identity matrix is not valid for A2B transforms')
    }
  }

  let inputEntries: number
  let outputEntries: number
  let cursor: number
  if (variant === 1) {
    inputEntries = 256
    outputEntries = 256
    cursor = offset + 48
  } else {
    inputEntries = view.getUint16(offset + 48)
    outputEntries = view.getUint16(offset + 50)
    if (inputEntries < 2 || outputEntries < 2) throw new IccUnprocessableError('ICC mft2 table entry counts must be at least 2')
    cursor = offset + 52
  }

  const readValue = variant === 1
    ? function (at: number): number { return data[at]! / 255 }
    : function (at: number): number { return view.getUint16(at) / 65535 }
  const valueSize = variant === 1 ? 1 : 2

  const inputTables: Float64Array[] = []
  for (let ch = 0; ch < inputChannels; ch++) {
    const table = new Float64Array(inputEntries)
    for (let i = 0; i < inputEntries; i++) {
      table[i] = readValue(cursor)
      cursor += valueSize
    }
    inputTables.push(table)
  }

  const clutSize = Math.pow(gridPoints, inputChannels) * outputChannels
  const clutBase = cursor
  cursor += clutSize * valueSize

  const outputTables: Float64Array[] = []
  for (let ch = 0; ch < outputChannels; ch++) {
    const table = new Float64Array(outputEntries)
    for (let i = 0; i < outputEntries; i++) {
      table[i] = readValue(cursor)
      cursor += valueSize
    }
    outputTables.push(table)
  }
  if (cursor > entry.offset + entry.size) throw new IccUnprocessableError('ICC LUT data exceeds the tag size')

  const clutLookup = function (at: number): number { return readValue(clutBase + at * valueSize) }
  const pcsDecode = pcs === PCS_LAB
    ? (variant === 1 ? lab8ToXyz : lab16LegacyToXyz)
    : xyzEncodingToXyz

  return {
    components,
    sourceColorSpace: signatureText(view.getUint32(16)).trimEnd(),
    toXyz(values: number[]): [number, number, number] {
      const shaped: number[] = []
      for (let ch = 0; ch < inputChannels; ch++) {
        shaped.push(interpolateTable(inputTables[ch]!, clamp01(values[ch]!)))
      }
      const pcsValues = sampleClut(shaped, gridPoints, outputChannels, clutLookup)
      for (let ch = 0; ch < outputChannels; ch++) {
        pcsValues[ch] = interpolateTable(outputTables[ch]!, clamp01(pcsValues[ch]!))
      }
      const xyz = pcsDecode(pcsValues[0]!, pcsValues[1]!, pcsValues[2]!)
      return xyz
    },
    toRgb(values: number[]): [number, number, number] {
      const xyz = this.toXyz(values)
      return xyzD50ToSrgb(xyz[0], xyz[1], xyz[2])
    },
  }
}

/** v4 lutAtoBType: B-curves ∘ matrix ∘ M-curves ∘ CLUT ∘ A-curves (device side). */
function parseMabTag(view: DataView, data: Uint8Array, entry: TagEntry, components: number, pcs: number): IccPcsTransform | null {
  const offset = entry.offset
  const inputChannels = data[offset + 8]!
  const outputChannels = data[offset + 9]!
  if (inputChannels !== components) {
    throw new IccUnprocessableError(`ICC mAB input channels (${inputChannels}) do not match the color space (${components})`)
  }
  if (outputChannels !== 3) return null
  const bCurvesOffset = view.getUint32(offset + 12)
  const matrixOffset = view.getUint32(offset + 16)
  const mCurvesOffset = view.getUint32(offset + 20)
  const clutOffset = view.getUint32(offset + 24)
  const aCurvesOffset = view.getUint32(offset + 28)
  const end = entry.offset + entry.size

  const aCurves = aCurvesOffset !== 0 ? readCurveSet(view, data, offset + aCurvesOffset, end, inputChannels) : null
  const mCurves = mCurvesOffset !== 0 ? readCurveSet(view, data, offset + mCurvesOffset, end, outputChannels) : null
  const bCurves = readCurveSet(view, data, offset + bCurvesOffset, end, outputChannels)

  let matrix: number[] | null = null
  if (matrixOffset !== 0) {
    matrix = []
    for (let i = 0; i < 12; i++) matrix.push(view.getInt32(offset + matrixOffset + i * 4) / 65536)
  }

  let clut: { gridPoints: number[], lookup: (at: number) => number } | null = null
  if (clutOffset !== 0) {
    const base = offset + clutOffset
    const gridPoints: number[] = []
    for (let i = 0; i < inputChannels; i++) {
      const points = data[base + i]!
      if (points < 2) throw new IccUnprocessableError('ICC mAB CLUT requires at least two grid points per input')
      gridPoints.push(points)
    }
    const precision = data[base + 16]!
    if (precision !== 1 && precision !== 2) throw new IccUnprocessableError(`ICC mAB CLUT precision ${precision} is invalid`)
    const dataBase = base + 20
    const lookup = precision === 1
      ? function (at: number): number { return data[dataBase + at]! / 255 }
      : function (at: number): number { return view.getUint16(dataBase + at * 2) / 65535 }
    clut = { gridPoints, lookup }
  } else if (inputChannels !== outputChannels) {
    throw new IccUnprocessableError('ICC mAB without a CLUT requires matching channel counts')
  }

  const pcsDecode = pcs === PCS_LAB ? lab4ToXyz : xyzEncodingToXyz

  return {
    components,
    sourceColorSpace: signatureText(view.getUint32(16)).trimEnd(),
    toXyz(values: number[]): [number, number, number] {
      let stage: number[] = []
      for (let ch = 0; ch < inputChannels; ch++) stage.push(clamp01(values[ch]!))
      if (aCurves !== null) {
        for (let ch = 0; ch < stage.length; ch++) stage[ch] = aCurves[ch]!(stage[ch]!)
      }
      if (clut !== null) {
        stage = sampleClutNonUniform(stage, clut.gridPoints, outputChannels, clut.lookup)
      }
      if (mCurves !== null) {
        for (let ch = 0; ch < stage.length; ch++) stage[ch] = mCurves[ch]!(clamp01(stage[ch]!))
      }
      if (matrix !== null) {
        const x = stage[0]!
        const y = stage[1]!
        const z = stage[2]!
        stage = [
          matrix[0]! * x + matrix[1]! * y + matrix[2]! * z + matrix[9]!,
          matrix[3]! * x + matrix[4]! * y + matrix[5]! * z + matrix[10]!,
          matrix[6]! * x + matrix[7]! * y + matrix[8]! * z + matrix[11]!,
        ]
      }
      for (let ch = 0; ch < 3; ch++) stage[ch] = bCurves[ch]!(clamp01(stage[ch]!))
      const xyz = pcsDecode(stage[0]!, stage[1]!, stage[2]!)
      return xyz
    },
    toRgb(values: number[]): [number, number, number] {
      const xyz = this.toXyz(values)
      return xyzD50ToSrgb(xyz[0], xyz[1], xyz[2])
    },
  }
}

function readCurveSet(view: DataView, data: Uint8Array, offset: number, end: number, count: number): Curve[] {
  const curves: Curve[] = []
  let cursor = offset
  for (let i = 0; i < count; i++) {
    const curve = parseCurveAt(view, data, cursor, end)
    curves.push(curve)
    // Advance past the curve element (4-byte aligned)
    const type = view.getUint32(cursor)
    let size: number
    if (type === 0x63757276) {
      const points = view.getUint32(cursor + 8)
      size = 12 + points * 2
    } else {
      const funcType = view.getUint16(cursor + 8)
      const paramCount = [1, 3, 4, 5, 7][funcType]!
      size = 12 + paramCount * 4
    }
    cursor += (size + 3) & ~3
  }
  return curves
}

// ─── CLUT sampling ───

/** Multilinear interpolation over a uniform CLUT (same grid size per axis). */
function sampleClut(inputs: number[], gridPoints: number, outputChannels: number, lookup: (at: number) => number): number[] {
  const gridSizes: number[] = []
  for (let i = 0; i < inputs.length; i++) gridSizes.push(gridPoints)
  return sampleClutNonUniform(inputs, gridSizes, outputChannels, lookup)
}

/** Multilinear interpolation over a CLUT with per-axis grid sizes. */
function sampleClutNonUniform(inputs: number[], gridPoints: number[], outputChannels: number, lookup: (at: number) => number): number[] {
  const dims = inputs.length
  const bases: number[] = []
  const fractions: number[] = []
  for (let i = 0; i < dims; i++) {
    const position = clamp01(inputs[i]!) * (gridPoints[i]! - 1)
    let base = Math.floor(position)
    if (base >= gridPoints[i]! - 1) base = gridPoints[i]! - 2 < 0 ? 0 : gridPoints[i]! - 2
    bases.push(base)
    fractions.push(position - base)
  }
  // Strides in output-channel units (last axis varies fastest)
  const strides = new Array<number>(dims)
  let stride = outputChannels
  for (let i = dims - 1; i >= 0; i--) {
    strides[i] = stride
    stride *= gridPoints[i]!
  }
  const corners = 1 << dims
  const result = new Array<number>(outputChannels).fill(0)
  for (let corner = 0; corner < corners; corner++) {
    let weight = 1
    let at = 0
    for (let i = 0; i < dims; i++) {
      const upper = (corner >> i) & 1
      const index = Math.min(bases[i]! + upper, gridPoints[i]! - 1)
      weight *= upper === 1 ? fractions[i]! : 1 - fractions[i]!
      at += index * strides[i]!
    }
    if (weight === 0) continue
    for (let ch = 0; ch < outputChannels; ch++) {
      result[ch] = result[ch]! + lookup(at + ch) * weight
    }
  }
  return result
}

// ─── PCS decodings ───

function encodePcsXyz(
  xyz: readonly [number, number, number],
  pcs: number,
  variant: 1 | 2 | 4,
): number[] {
  if (pcs === PCS_XYZ) {
    const scale = 65535 / 32768
    return [clamp01(xyz[0] / scale), clamp01(xyz[1] / scale), clamp01(xyz[2] / scale)]
  }
  const lab = xyzD50ToLab(xyz[0], xyz[1], xyz[2])
  if (variant === 2) {
    const legacyScale = 65535 / 65280
    return [
      clamp01(lab[0] / (100 * legacyScale)),
      clamp01((lab[1] + 128) * 256 / 65535 / legacyScale),
      clamp01((lab[2] + 128) * 256 / 65535 / legacyScale),
    ]
  }
  return [clamp01(lab[0] / 100), clamp01((lab[1] + 128) / 255), clamp01((lab[2] + 128) / 255)]
}

function xyzD50ToLab(x: number, y: number, z: number): [number, number, number] {
  const fx = labForward(x / D50_WHITE[0])
  const fy = labForward(y / D50_WHITE[1])
  const fz = labForward(z / D50_WHITE[2])
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function labForward(value: number): number {
  return value > 216 / 24389 ? Math.cbrt(value) : value * 841 / 108 + 4 / 29
}

/** mft1 8-bit PCSLab: L 0..100 over 0..255, a/b -128..127 over 0..255. */
function lab8ToXyz(l: number, a: number, b: number): [number, number, number] {
  return labToXyzD50(l * 100, a * 255 - 128, b * 255 - 128)
}

/** mft2 16-bit legacy PCSLab: L 0..100 over 0..0xFF00/0xFFFF scale. */
function lab16LegacyToXyz(l: number, a: number, b: number): [number, number, number] {
  const scale = 65535 / 65280
  return labToXyzD50(l * 100 * scale, (a * 65535 / 256) * scale - 128, (b * 65535 / 256) * scale - 128)
}

/** v4 16-bit PCSLab (used by lutAtoBType): L 0..100, a/b -128..127 over full range. */
function lab4ToXyz(l: number, a: number, b: number): [number, number, number] {
  return labToXyzD50(l * 100, a * 255 - 128, b * 255 - 128)
}

/** PCSXYZ encoding: u1Fixed15 (0..~1.99997) over the 0..1 sample range. */
function xyzEncodingToXyz(x: number, y: number, z: number): [number, number, number] {
  const scale = 65535 / 32768
  return [x * scale, y * scale, z * scale]
}

function labToXyzD50(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  return [0.9642 * labInverse(fx), labInverse(fy), 0.8249 * labInverse(fz)]
}

function labInverse(t: number): number {
  const t3 = t * t * t
  return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787
}

// ─── PCS(D50) -> sRGB ───

function xyzD50ToSrgb(x: number, y: number, z: number): [number, number, number] {
  return xyzWithWhitePointToSrgb(x, y, z, D50_WHITE)
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
