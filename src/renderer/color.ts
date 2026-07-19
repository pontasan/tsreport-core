// Template color parsing shared by every backend. Colors travel as strings
// through the whole pipeline; besides #RGB/#RRGGBB(AA) the template accepts
// print and calibrated colors:
//   cmyk(C,M,Y,K)        - process color, components in percent (0-100)
//   spot(Name,C,M,Y,K)   - spot color with its CMYK alternate (percent)
//   devicen(Name1,Name2;T1,T2;C,M,Y,K)
//   calgray(G,WX,WY,WZ,Gamma)
//   calrgb(R,G,B,WX,WY,WZ,GR,GG,GB[, nine Matrix values])
//   lab(L,A,B,WX,WY,WZ[, AMin,AMax,BMin,BMax])
// The PDF backend emits these natively; Canvas and SVG display an sRGB
// approximation.

import { xyzWithWhitePointToSrgb } from '../pdf/xyz-color.js'

export type CalibratedColor =
  | {
      kind: 'calgray'
      gray: number
      whitePoint: [number, number, number]
      gamma: number
    }
  | {
      kind: 'calrgb'
      components: [number, number, number]
      whitePoint: [number, number, number]
      gamma: [number, number, number]
      matrix: [number, number, number, number, number, number, number, number, number]
    }
  | {
      kind: 'lab'
      components: [number, number, number]
      whitePoint: [number, number, number]
      range: [number, number, number, number]
    }

export interface DeviceNColor {
  names: string[]
  tints: number[]
  alternateCmyk: [number, number, number, number]
}

export interface TemplateColor {
  /** sRGB approximation, 0..1 */
  r: number
  g: number
  b: number
  /** Native CMYK components 0..1 (null for RGB colors) */
  cmyk: [number, number, number, number] | null
  /** Spot color name (null for process colors) */
  spotName: string | null
  /** DeviceN process/spot colorants (null for non-DeviceN colors) */
  deviceN: DeviceNColor | null
  /** Native calibrated PDF color space (null for RGB/CMYK/spot colors) */
  calibrated: CalibratedColor | null
  /** Alpha 0..1 (from #RRGGBBAA; print colors are opaque) */
  alpha: number
}

const CMYK_PATTERN = /^cmyk\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i
const SPOT_PATTERN = /^spot\(\s*([^,()]*?)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i
const DEVICEN_PATTERN = /^devicen\(\s*([^;()]+?)\s*;\s*([^;()]+?)\s*;\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]
}

function percentList(value: string): number[] {
  return value.split(',').map(function (part) {
    return clamp01(parseFloat(part.trim()) / 100)
  })
}

function cmykPercentArgs(values: RegExpExecArray, offset: number): [number, number, number, number] {
  return [
    clamp01(parseFloat(values[offset]!) / 100),
    clamp01(parseFloat(values[offset + 1]!) / 100),
    clamp01(parseFloat(values[offset + 2]!) / 100),
    clamp01(parseFloat(values[offset + 3]!) / 100),
  ]
}

function parseFunctionArgs(value: string, name: string): number[] | null {
  const prefix = name + '('
  if (!value.toLowerCase().startsWith(prefix) || !value.endsWith(')')) return null
  const body = value.slice(prefix.length, -1).trim()
  if (body.length === 0) return []
  return body.split(',').map(function (part) {
    const n = parseFloat(part.trim())
    if (!Number.isFinite(n)) throw new Error(`Invalid ${name}() color component: ${part}`)
    return n
  })
}

function positive(value: number, fallback: number): number {
  return value > 0 ? value : fallback
}

function whitePoint(args: number[], offset: number): [number, number, number] {
  const wx = args[offset]!
  const wy = args[offset + 1]!
  const wz = args[offset + 2]!
  if (!(wx > 0) || !(wy > 0) || !(wz > 0)) {
    throw new Error('Calibrated color WhitePoint values must be positive')
  }
  return [wx, wy, wz]
}

function labToRgb(l: number, a: number, b: number, wp: [number, number, number]): [number, number, number] {
  const fy = (l + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const xr = labPivotInverse(fx)
  const yr = l > 8 ? Math.pow((l + 16) / 116, 3) : l / 903.3
  const zr = labPivotInverse(fz)
  return xyzWithWhitePointToSrgb(xr * wp[0], yr * wp[1], zr * wp[2], wp)
}

function labPivotInverse(v: number): number {
  const v3 = v * v * v
  return v3 > 216 / 24389 ? v3 : (116 * v - 16) / 903.3
}

function calrgbToRgb(
  components: [number, number, number],
  white: [number, number, number],
  gamma: [number, number, number],
  matrix: [number, number, number, number, number, number, number, number, number],
): [number, number, number] {
  const a = Math.pow(components[0], gamma[0])
  const b = Math.pow(components[1], gamma[1])
  const c = Math.pow(components[2], gamma[2])
  const x = matrix[0] * a + matrix[3] * b + matrix[6] * c
  const y = matrix[1] * a + matrix[4] * b + matrix[7] * c
  const z = matrix[2] * a + matrix[5] * b + matrix[8] * c
  return xyzWithWhitePointToSrgb(x, y, z, white)
}

export function parseTemplateColor(color: string): TemplateColor {
  const trimmed = color.trim()
  const cmyk = CMYK_PATTERN.exec(trimmed)
  if (cmyk !== null) {
    const comps = cmykPercentArgs(cmyk, 1)
    const [r, g, b] = cmykToRgb(comps[0], comps[1], comps[2], comps[3])
    return { r, g, b, cmyk: comps, spotName: null, deviceN: null, calibrated: null, alpha: 1 }
  }
  const spot = SPOT_PATTERN.exec(trimmed)
  if (spot !== null) {
    const comps = cmykPercentArgs(spot, 2)
    const [r, g, b] = cmykToRgb(comps[0], comps[1], comps[2], comps[3])
    // A spot() with an empty name (transient editing state) behaves as a
    // plain process color until the name is filled in
    const spotName = spot[1]!.length > 0 ? spot[1]! : null
    return { r, g, b, cmyk: comps, spotName, deviceN: null, calibrated: null, alpha: 1 }
  }
  const deviceN = DEVICEN_PATTERN.exec(trimmed)
  if (deviceN !== null) {
    const names = deviceN[1]!.split(',').map(part => part.trim()).filter(part => part.length > 0)
    const tints = percentList(deviceN[2]!)
    if (names.length === 0 || names.length !== tints.length) {
      throw new Error('devicen() expects the same number of names and tint values')
    }
    const alternateCmyk = cmykPercentArgs(deviceN, 3)
    const [r, g, b] = cmykToRgb(alternateCmyk[0], alternateCmyk[1], alternateCmyk[2], alternateCmyk[3])
    return {
      r, g, b,
      cmyk: null,
      spotName: null,
      deviceN: { names, tints, alternateCmyk },
      calibrated: null,
      alpha: 1,
    }
  }
  const calgray = parseFunctionArgs(trimmed, 'calgray')
  if (calgray !== null) {
    if (calgray.length !== 5) throw new Error('calgray() expects G, WhitePoint[3], Gamma')
    const gray = clamp01(calgray[0]!)
    const wp = whitePoint(calgray, 1)
    const gamma = positive(calgray[4]!, 1)
    const y = Math.pow(gray, gamma)
    const [r, g, b] = xyzWithWhitePointToSrgb(y * wp[0], y * wp[1], y * wp[2], wp)
    return {
      r, g, b,
      cmyk: null,
      spotName: null,
      deviceN: null,
      calibrated: { kind: 'calgray', gray, whitePoint: wp, gamma },
      alpha: 1,
    }
  }
  const calrgb = parseFunctionArgs(trimmed, 'calrgb')
  if (calrgb !== null) {
    if (calrgb.length !== 9 && calrgb.length !== 18) {
      throw new Error('calrgb() expects RGB, WhitePoint[3], Gamma[3], and optional Matrix[9]')
    }
    const comps: [number, number, number] = [clamp01(calrgb[0]!), clamp01(calrgb[1]!), clamp01(calrgb[2]!)]
    const wp = whitePoint(calrgb, 3)
    const gamma: [number, number, number] = [
      positive(calrgb[6]!, 1),
      positive(calrgb[7]!, 1),
      positive(calrgb[8]!, 1),
    ]
    const matrix: [number, number, number, number, number, number, number, number, number] = calrgb.length === 18
      ? [
          calrgb[9]!, calrgb[10]!, calrgb[11]!,
          calrgb[12]!, calrgb[13]!, calrgb[14]!,
          calrgb[15]!, calrgb[16]!, calrgb[17]!,
        ]
      : [1, 0, 0, 0, 1, 0, 0, 0, 1]
    const [r, g, b] = calrgbToRgb(comps, wp, gamma, matrix)
    return {
      r, g, b,
      cmyk: null,
      spotName: null,
      deviceN: null,
      calibrated: { kind: 'calrgb', components: comps, whitePoint: wp, gamma, matrix },
      alpha: 1,
    }
  }
  const lab = parseFunctionArgs(trimmed, 'lab')
  if (lab !== null) {
    if (lab.length !== 6 && lab.length !== 10) throw new Error('lab() expects Lab, WhitePoint[3], and optional Range[4]')
    const wp = whitePoint(lab, 3)
    const range: [number, number, number, number] = lab.length === 10
      ? [lab[6]!, lab[7]!, lab[8]!, lab[9]!]
      : [-100, 100, -100, 100]
    const comps: [number, number, number] = [
      Math.max(0, Math.min(100, lab[0]!)),
      Math.max(range[0], Math.min(range[1], lab[1]!)),
      Math.max(range[2], Math.min(range[3], lab[2]!)),
    ]
    const [r, g, b] = labToRgb(comps[0], comps[1], comps[2], wp)
    return {
      r, g, b,
      cmyk: null,
      spotName: null,
      deviceN: null,
      calibrated: { kind: 'lab', components: comps, whitePoint: wp, range },
      alpha: 1,
    }
  }
  const h = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  if (h.length === 3 || h.length === 4) {
    return {
      r: parseInt(h[0]! + h[0]!, 16) / 255,
      g: parseInt(h[1]! + h[1]!, 16) / 255,
      b: parseInt(h[2]! + h[2]!, 16) / 255,
      cmyk: null,
      spotName: null,
      deviceN: null,
      calibrated: null,
      alpha: h.length === 4 ? parseInt(h[3]! + h[3]!, 16) / 255 : 1,
    }
  }
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
    cmyk: null,
    spotName: null,
    deviceN: null,
    calibrated: null,
    alpha: h.length >= 8 ? parseInt(h.substring(6, 8), 16) / 255 : 1,
  }
}

/** True when the string uses a native PDF color form beyond device RGB. */
export function isPrintColor(color: string): boolean {
  const c = color.trim()
  if (c.length === 0) return false
  switch (c.charCodeAt(0) | 0x20) {
    case 0x63: // c
      if (startsWithAsciiIgnoreCase(c, 'cmyk(')) return CMYK_PATTERN.test(c)
      if (startsWithAsciiIgnoreCase(c, 'calgray(')) return parseFunctionArgs(c, 'calgray') !== null
      return startsWithAsciiIgnoreCase(c, 'calrgb(') && parseFunctionArgs(c, 'calrgb') !== null
    case 0x64: // d
      return startsWithAsciiIgnoreCase(c, 'devicen(') && DEVICEN_PATTERN.test(c)
    case 0x6c: // l
      return startsWithAsciiIgnoreCase(c, 'lab(') && parseFunctionArgs(c, 'lab') !== null
    case 0x73: // s
      return startsWithAsciiIgnoreCase(c, 'spot(') && SPOT_PATTERN.test(c)
    default:
      return false
  }
}

function startsWithAsciiIgnoreCase(value: string, prefix: string): boolean {
  if (value.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if ((value.charCodeAt(i) | 0x20) !== prefix.charCodeAt(i)) return false
  }
  return true
}

/**
 * Converts a print color to its #RRGGBB approximation for CSS/SVG contexts;
 * every other string passes through unchanged.
 */
export function toDisplayColor(color: string): string {
  if (!isPrintColor(color)) return color
  const parsed = parseTemplateColor(color)
  const hex = function (v: number): string {
    const b = Math.max(0, Math.min(255, Math.round(v * 255)))
    return (b < 16 ? '0' : '') + b.toString(16)
  }
  return '#' + hex(parsed.r) + hex(parsed.g) + hex(parsed.b)
}
