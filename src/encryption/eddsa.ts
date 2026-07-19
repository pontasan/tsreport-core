/** RFC 8032 Ed25519 and Ed448 primitives implemented with native BigInt. */

import { sha512 } from './sha512.js'
import { shake256 } from './sha3.js'

export type EdDsaCurveName = 'Ed25519' | 'Ed448'

interface EdwardsCurve {
  name: EdDsaCurveName
  p: bigint
  a: bigint
  d: bigint
  order: bigint
  baseX: bigint
  baseY: bigint
  encodedLength: number
  seedLength: number
  cofactor: bigint
}

interface EdwardsPoint {
  x: bigint
  y: bigint
  z: bigint
}

function mod(value: bigint, modulus: bigint): bigint {
  const result = value % modulus
  return result < 0n ? result + modulus : result
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n
  let factor = mod(base, modulus)
  let power = exponent
  while (power > 0n) {
    if ((power & 1n) !== 0n) result = result * factor % modulus
    factor = factor * factor % modulus
    power >>= 1n
  }
  return result
}

const ED25519_P = (1n << 255n) - 19n
const ED448_P = (1n << 448n) - (1n << 224n) - 1n

const ED25519: EdwardsCurve = {
  name: 'Ed25519',
  p: ED25519_P,
  a: ED25519_P - 1n,
  d: mod(-121665n * modPow(121666n, ED25519_P - 2n, ED25519_P), ED25519_P),
  order: (1n << 252n) + 27742317777372353535851937790883648493n,
  baseX: 15112221349535400772501151409588531511454012693041857206046113283949847762202n,
  baseY: 46316835694926478169428394003475163141307993866256225615783033603165251855960n,
  encodedLength: 32,
  seedLength: 32,
  cofactor: 8n,
}

const ED448: EdwardsCurve = {
  name: 'Ed448',
  p: ED448_P,
  a: 1n,
  d: ED448_P - 39081n,
  order: (1n << 446n) - 13818066809895115352007386748515426880336692474882178609894547503885n,
  baseX: 224580040295924300187604334099896036246789641632564134246125461686950415467406032909029192869357953282578032075146446173674602635247710n,
  baseY: 298819210078481492676017930443930673437544040154080242095928241372331506189835876003536878655418784733982303233503462500531545062832660n,
  encodedLength: 57,
  seedLength: 57,
  cofactor: 4n,
}

function curveByName(name: EdDsaCurveName): EdwardsCurve {
  return name === 'Ed25519' ? ED25519 : ED448
}

function littleEndianToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]!)
  return value
}

function bigIntToLittleEndian(value: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length)
  let remaining = value
  for (let i = 0; i < length; i++) {
    result[i] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let length = 0
  for (let i = 0; i < parts.length; i++) length += parts[i]!.length
  const result = new Uint8Array(length)
  let offset = 0
  for (let i = 0; i < parts.length; i++) {
    result.set(parts[i]!, offset)
    offset += parts[i]!.length
  }
  return result
}

function pointAdd(curve: EdwardsCurve, left: EdwardsPoint, right: EdwardsPoint): EdwardsPoint {
  const p = curve.p
  const a = left.z * right.z % p
  const b = a * a % p
  const c = left.x * right.x % p
  const d = left.y * right.y % p
  const e = curve.d * c % p * d % p
  const f = mod(b - e, p)
  const g = (b + e) % p
  const cross = mod((left.x + left.y) * (right.x + right.y) - c - d, p)
  return {
    x: a * f % p * cross % p,
    y: a * g % p * mod(d - curve.a * c, p) % p,
    z: f * g % p,
  }
}

function pointMultiply(curve: EdwardsCurve, scalar: bigint, point: EdwardsPoint): EdwardsPoint {
  let result: EdwardsPoint = { x: 0n, y: 1n, z: 1n }
  let addend = point
  let remaining = scalar
  while (remaining > 0n) {
    if ((remaining & 1n) !== 0n) result = pointAdd(curve, result, addend)
    addend = pointAdd(curve, addend, addend)
    remaining >>= 1n
  }
  return result
}

function pointsEqual(curve: EdwardsCurve, left: EdwardsPoint, right: EdwardsPoint): boolean {
  return mod(left.x * right.z - right.x * left.z, curve.p) === 0n
    && mod(left.y * right.z - right.y * left.z, curve.p) === 0n
}

function squareRoot(curve: EdwardsCurve, value: bigint): bigint | null {
  const normalized = mod(value, curve.p)
  let root: bigint
  if (curve.name === 'Ed25519') {
    root = modPow(normalized, (curve.p + 3n) / 8n, curve.p)
    if (root * root % curve.p !== normalized) {
      root = root * modPow(2n, (curve.p - 1n) / 4n, curve.p) % curve.p
    }
  } else {
    root = modPow(normalized, (curve.p + 1n) / 4n, curve.p)
  }
  return root * root % curve.p === normalized ? root : null
}

function decodePoint(curve: EdwardsCurve, encoded: Uint8Array): EdwardsPoint | null {
  if (encoded.length !== curve.encodedLength) return null
  const copy = Uint8Array.from(encoded)
  const sign = copy[copy.length - 1]! >>> 7
  copy[copy.length - 1] = copy[copy.length - 1]! & 0x7f
  const y = littleEndianToBigInt(copy)
  if (y >= curve.p) return null
  const ySquared = y * y % curve.p
  const denominator = mod(curve.d * ySquared - curve.a, curve.p)
  if (denominator === 0n) return null
  const xSquared = mod((ySquared - 1n) * modPow(denominator, curve.p - 2n, curve.p), curve.p)
  let x = squareRoot(curve, xSquared)
  if (x === null || (x === 0n && sign !== 0)) return null
  if (Number(x & 1n) !== sign) x = curve.p - x
  return { x, y, z: 1n }
}

function encodePoint(curve: EdwardsCurve, point: EdwardsPoint): Uint8Array {
  const inverseZ = modPow(point.z, curve.p - 2n, curve.p)
  const x = point.x * inverseZ % curve.p
  const y = point.y * inverseZ % curve.p
  const encoded = bigIntToLittleEndian(y, curve.encodedLength)
  encoded[encoded.length - 1] = encoded[encoded.length - 1]! | (Number(x & 1n) << 7)
  return encoded
}

function basePoint(curve: EdwardsCurve): EdwardsPoint {
  return { x: curve.baseX, y: curve.baseY, z: 1n }
}

function hashSecret(curve: EdwardsCurve, seed: Uint8Array): Uint8Array {
  return curve.name === 'Ed25519' ? sha512(seed) : shake256(seed, 114)
}

function pruneSecret(curve: EdwardsCurve, hash: Uint8Array): bigint {
  const scalar = Uint8Array.from(hash.subarray(0, curve.encodedLength))
  if (curve.name === 'Ed25519') {
    scalar[0] = scalar[0]! & 0xf8
    scalar[31] = scalar[31]! & 0x3f
    scalar[31] = scalar[31]! | 0x40
  } else {
    scalar[0] = scalar[0]! & 0xfc
    scalar[55] = scalar[55]! | 0x80
    scalar[56] = 0
  }
  return littleEndianToBigInt(scalar)
}

function dom4(curve: EdwardsCurve): Uint8Array {
  if (curve.name === 'Ed25519') return new Uint8Array(0)
  return concatBytes(new TextEncoder().encode('SigEd448'), new Uint8Array([0, 0]))
}

function messageHash(curve: EdwardsCurve, data: Uint8Array): Uint8Array {
  return curve.name === 'Ed25519' ? sha512(data) : shake256(data, 114)
}

export function deriveEdDsaPublicKey(name: EdDsaCurveName, seed: Uint8Array): Uint8Array {
  const curve = curveByName(name)
  if (seed.length !== curve.seedLength) throw new Error(`${name} private seed must be ${curve.seedLength} bytes`)
  const scalar = pruneSecret(curve, hashSecret(curve, seed))
  return encodePoint(curve, pointMultiply(curve, scalar, basePoint(curve)))
}

export function signEdDsa(name: EdDsaCurveName, seed: Uint8Array, message: Uint8Array): Uint8Array {
  const curve = curveByName(name)
  if (seed.length !== curve.seedLength) throw new Error(`${name} private seed must be ${curve.seedLength} bytes`)
  const secretHash = hashSecret(curve, seed)
  const scalar = pruneSecret(curve, secretHash)
  const publicKey = encodePoint(curve, pointMultiply(curve, scalar, basePoint(curve)))
  const prefix = secretHash.subarray(curve.encodedLength, curve.encodedLength * 2)
  const domain = dom4(curve)
  const nonce = littleEndianToBigInt(messageHash(curve, concatBytes(domain, prefix, message))) % curve.order
  const encodedR = encodePoint(curve, pointMultiply(curve, nonce, basePoint(curve)))
  const challenge = littleEndianToBigInt(messageHash(curve, concatBytes(domain, encodedR, publicKey, message))) % curve.order
  const s = mod(nonce + challenge * scalar, curve.order)
  return concatBytes(encodedR, bigIntToLittleEndian(s, curve.encodedLength))
}

export function verifyEdDsa(
  name: EdDsaCurveName,
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  const curve = curveByName(name)
  if (signature.length !== curve.encodedLength * 2) return false
  const publicPoint = decodePoint(curve, publicKey)
  const encodedR = signature.subarray(0, curve.encodedLength)
  const rPoint = decodePoint(curve, encodedR)
  const s = littleEndianToBigInt(signature.subarray(curve.encodedLength))
  if (publicPoint === null || rPoint === null || s >= curve.order) return false
  const challenge = littleEndianToBigInt(messageHash(curve, concatBytes(dom4(curve), encodedR, publicKey, message))) % curve.order
  const left = pointMultiply(curve, curve.cofactor * s, basePoint(curve))
  const right = pointAdd(
    curve,
    pointMultiply(curve, curve.cofactor, rPoint),
    pointMultiply(curve, curve.cofactor * challenge, publicPoint),
  )
  return pointsEqual(curve, left, right)
}
