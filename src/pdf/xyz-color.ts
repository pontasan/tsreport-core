/**
 * Shared CIE XYZ -> sRGB conversion with Bradford chromatic adaptation.
 * Used by calibrated PDF color spaces (CalGray/CalRGB/Lab) and the ICC
 * profile reader (PCS is always D50).
 */

export const D50_WHITE: [number, number, number] = [0.9642, 1, 0.8249]

export function xyzToSrgb(x: number, y: number, z: number): [number, number, number] {
  const r = srgbGamma(3.2406 * x - 1.5372 * y - 0.4986 * z)
  const g = srgbGamma(-0.9689 * x + 1.8758 * y + 0.0415 * z)
  const b = srgbGamma(0.0557 * x - 0.2040 * y + 1.0570 * z)
  return [r, g, b]
}

export function xyzWithWhitePointToSrgb(x: number, y: number, z: number, sourceWhite: [number, number, number]): [number, number, number] {
  const adapted = adaptXyzToD65(x, y, z, sourceWhite)
  return xyzToSrgb(adapted[0], adapted[1], adapted[2])
}

/** Converts encoded sRGB to XYZ and adapts D65 to `destinationWhite`. */
export function srgbToXyzWithWhitePoint(
  r: number,
  g: number,
  b: number,
  destinationWhite: [number, number, number],
): [number, number, number] {
  const lr = srgbInverseGamma(r)
  const lg = srgbInverseGamma(g)
  const lb = srgbInverseGamma(b)
  const d65: [number, number, number] = [
    0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb,
    0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb,
    0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb,
  ]
  return adaptXyzWhitePoint(d65[0], d65[1], d65[2], [0.95047, 1, 1.08883], destinationWhite)
}

export function adaptXyzToD65(x: number, y: number, z: number, sourceWhite: [number, number, number]): [number, number, number] {
  return adaptXyzWhitePoint(x, y, z, sourceWhite, [0.95047, 1, 1.08883])
}

/** Bradford chromatic adaptation between arbitrary source and destination whites. */
export function adaptXyzWhitePoint(
  x: number,
  y: number,
  z: number,
  sourceWhite: [number, number, number],
  destinationWhite: [number, number, number],
): [number, number, number] {
  const srcL = 0.8951 * sourceWhite[0] + 0.2664 * sourceWhite[1] - 0.1614 * sourceWhite[2]
  const srcM = -0.7502 * sourceWhite[0] + 1.7135 * sourceWhite[1] + 0.0367 * sourceWhite[2]
  const srcS = 0.0389 * sourceWhite[0] - 0.0685 * sourceWhite[1] + 1.0296 * sourceWhite[2]
  const dstL = 0.8951 * destinationWhite[0] + 0.2664 * destinationWhite[1] - 0.1614 * destinationWhite[2]
  const dstM = -0.7502 * destinationWhite[0] + 1.7135 * destinationWhite[1] + 0.0367 * destinationWhite[2]
  const dstS = 0.0389 * destinationWhite[0] - 0.0685 * destinationWhite[1] + 1.0296 * destinationWhite[2]
  const l = (0.8951 * x + 0.2664 * y - 0.1614 * z) * dstL / srcL
  const m = (-0.7502 * x + 1.7135 * y + 0.0367 * z) * dstM / srcM
  const s = (0.0389 * x - 0.0685 * y + 1.0296 * z) * dstS / srcS
  return [
    0.9869929 * l - 0.1470543 * m + 0.1599627 * s,
    0.4323053 * l + 0.5183603 * m + 0.0492912 * s,
    -0.0085287 * l + 0.0400428 * m + 0.9684867 * s,
  ]
}

function srgbGamma(v: number): number {
  const clamped = Math.max(0, Math.min(1, v))
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
}

function srgbInverseGamma(v: number): number {
  const clamped = Math.max(0, Math.min(1, v))
  return clamped <= 0.04045 ? clamped / 12.92 : Math.pow((clamped + 0.055) / 1.055, 2.4)
}
