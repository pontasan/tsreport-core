import { decodeJpegToRgba } from '../image/jpeg-decoder.js'
import { decodePng } from '../image/png-parser.js'
import { decodeTiffToRgba } from '../renderer/tiff-decoder.js'
import { winAnsiCodeForCodePoint } from './pdf-encoding.js'
import { getStandardFontMetrics, resolveStandardFontName } from './standard-font-metrics.js'

const U3D_FILE_HEADER = 0x00443355
const U3D_MODIFIER_CHAIN = 0xFFFFFF14
const U3D_GROUP_NODE = 0xFFFFFF21
const U3D_MODEL_NODE = 0xFFFFFF22
const U3D_LIGHT_NODE = 0xFFFFFF23
const U3D_VIEW_NODE = 0xFFFFFF24
const U3D_CLOD_MESH_DECLARATION = 0xFFFFFF31
const U3D_POINT_SET_DECLARATION = 0xFFFFFF36
const U3D_LINE_SET_DECLARATION = 0xFFFFFF37
const U3D_CLOD_BASE_MESH_CONTINUATION = 0xFFFFFF3B
const U3D_CLOD_PROGRESSIVE_MESH_CONTINUATION = 0xFFFFFF3C
const U3D_POINT_SET_CONTINUATION = 0xFFFFFF3E
const U3D_LINE_SET_CONTINUATION = 0xFFFFFF3F
const U3D_SHADING_MODIFIER = 0xFFFFFF45
const U3D_LIGHT_RESOURCE = 0xFFFFFF51
const U3D_LIT_TEXTURE_SHADER = 0xFFFFFF53
const U3D_MATERIAL_RESOURCE = 0xFFFFFF54
const U3D_TEXTURE_DECLARATION = 0xFFFFFF55
const U3D_TEXTURE_CONTINUATION = 0xFFFFFF5C

export type Pdf3DVector3 = [number, number, number]
export type Pdf3DMatrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
]

export interface U3dMetadataEntry {
  attributes: number
  key: string
  value: string | Uint8Array
}

export interface U3dBlock {
  type: number
  data: Uint8Array
  metadata: U3dMetadataEntry[]
  offset: number
  byteLength: number
}

export interface U3dHeader {
  majorVersion: number
  minorVersion: number
  profile: number
  declarationSize: number
  fileSize: number
  characterEncoding: 106
  unitsInMeters: number | null
}

export interface U3dDecodeOptions {
  resolveExternalTexture?: (urls: readonly string[], textureName: string, imageIndex: number) => Uint8Array
}

export interface Pdf3DParentTransform {
  name: string
  matrix: Pdf3DMatrix4
}

interface Pdf3DNodeBase {
  name: string
  parents: Pdf3DParentTransform[]
  sourceBlockOffset: number
}

export interface Pdf3DGroupNode extends Pdf3DNodeBase {
  kind: 'group'
}

export interface Pdf3DModelNode extends Pdf3DNodeBase {
  kind: 'model'
  resourceName: string
  visibility: 0 | 1 | 2 | 3
  color?: [number, number, number, number]
  surface?: Pdf3DSurfaceMaterial
  renderPasses?: Pdf3DRenderPass[]
}

export interface Pdf3DLightNode extends Pdf3DNodeBase {
  kind: 'light'
  resourceName: string
}

export interface U3dViewTextureLayer {
  textureName: string
  blend: number
  rotation: number
  location: [number, number]
  registration: [number, number]
  scale: [number, number]
}

export interface Pdf3DViewNode extends Pdf3DNodeBase {
  kind: 'view'
  resourceName: string
  screenUnits: 'pixels' | 'fraction'
  projection: 'perspective' | 'orthographic' | 'two-point' | 'one-point'
  nearClip: number
  farClip: number
  projectionValue: number | Pdf3DVector3
  viewport: [number, number, number, number]
  backdrops: U3dViewTextureLayer[]
  overlays: U3dViewTextureLayer[]
}

export type Pdf3DSceneNode = Pdf3DGroupNode | Pdf3DModelNode | Pdf3DLightNode | Pdf3DViewNode

export interface Pdf3DBoundingSphere {
  center: Pdf3DVector3
  radius: number
}

export interface Pdf3DBoundingBox {
  minimum: Pdf3DVector3
  maximum: Pdf3DVector3
}

export interface U3dModifierChain {
  name: string
  chainType: 0 | 1 | 2
  boundingSphere?: Pdf3DBoundingSphere
  boundingBox?: Pdf3DBoundingBox
  modifierBlocks: U3dBlock[]
}

export interface Pdf3DTrianglePrimitive {
  kind: 'triangles'
  name: string
  positions: Pdf3DVector3[]
  indices: number[]
  colors?: Array<[number, number, number, number]>
  normals?: Pdf3DVector3[]
  surfaces?: Pdf3DSurfaceMaterial[]
  faceRenderPasses?: Pdf3DRenderPass[][]
  faceTextureCoordinates?: Array<Array<[
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
  ]>>
}

export interface Pdf3DSurfaceMaterial {
  lighting: boolean
  ambient: Pdf3DVector3
  diffuse: Pdf3DVector3
  specular: Pdf3DVector3
  emissive: Pdf3DVector3
  reflectivity: number
  opacity: number
}

export interface Pdf3DTextureImage {
  width: number
  height: number
  rgba: Uint8Array
}

export interface Pdf3DTextureLayer {
  channel: number
  textureName: string
  image: Pdf3DTextureImage
  intensity: number
  blendFunction: 0 | 1 | 2 | 3
  blendSource: 0 | 1
  blendConstant: number
  textureMode: 0 | 1 | 2 | 3 | 4
  textureTransform: Pdf3DMatrix4
  wrapTransform: Pdf3DMatrix4
  repeat: number
  componentMask?: number
  blendColor?: [number, number, number, number]
  prcTextureFunction?: 2 | 3 | 4 | 5
  wrapModes?: [number, number]
}

export interface Pdf3DRenderPass {
  material: Pdf3DSurfaceMaterial
  alphaReference: number
  alphaCompare: number
  frameBufferBlend: number
  alphaTextureChannels: number
  layers: Pdf3DTextureLayer[]
}

export interface Pdf3DLightSource {
  name: string
  nodeName: string
  type: 'ambient' | 'directional' | 'point' | 'spot'
  enabled: boolean
  specular: boolean
  color: Pdf3DVector3
  ambientColor?: Pdf3DVector3
  diffuseColor?: Pdf3DVector3
  emissiveColor?: Pdf3DVector3
  specularColor?: Pdf3DVector3
  attenuation: Pdf3DVector3
  spotAngle: number
  spotExponent?: number
  intensity: number
}

export interface Pdf3DClippingPlane {
  point: Pdf3DVector3
  normal: Pdf3DVector3
}

export interface Pdf3DLinePrimitive {
  kind: 'lines'
  name: string
  positions: Pdf3DVector3[]
  indices: number[]
  colors?: Array<[number, number, number, number]>
  lineWidth?: number
}

export interface Pdf3DPointPrimitive {
  kind: 'points'
  name: string
  positions: Pdf3DVector3[]
  colors?: Array<[number, number, number, number]>
}

export interface Pdf3DTextPrimitive {
  kind: 'text'
  name: string
  positions: [Pdf3DVector3, Pdf3DVector3, Pdf3DVector3]
  text: string
  fontFamily: string
  fontAttributes: number
  color?: [number, number, number, number]
}

export type Pdf3DPrimitive = Pdf3DTrianglePrimitive | Pdf3DLinePrimitive | Pdf3DPointPrimitive | Pdf3DTextPrimitive

export interface Pdf3DScene {
  format: 'U3D'
  header: U3dHeader
  blocks: U3dBlock[]
  nodes: Pdf3DSceneNode[]
  modifierChains: U3dModifierChain[]
  primitives: Pdf3DPrimitive[]
  bounds: Pdf3DBoundingBox | null
  backgroundColor?: [number, number, number]
  lights?: Pdf3DLightSource[]
  clippingPlanes?: Pdf3DClippingPlane[]
}

export interface Prc3DScene {
  format: 'PRC'
  minimalVersion: number
  authoringVersion: number
  unitsInMeters: number | null
  nodes: Pdf3DSceneNode[]
  primitives: Pdf3DPrimitive[]
  bounds: Pdf3DBoundingBox | null
  backgroundColor?: [number, number, number]
  lights?: Pdf3DLightSource[]
  clippingPlanes?: Pdf3DClippingPlane[]
}

export type Pdf3DDecodedScene = Pdf3DScene | Prc3DScene

export interface Pdf3DMeasurement {
  sourceUnits: number
  metres: number | null
}

export interface Pdf3DPoster {
  width: number
  height: number
  /** PDF appearance-stream operators in a local [0,width] x [0,height] box. */
  content: string
  resources?: string
}

interface Pdf3DSceneGeometry {
  nodes: Pdf3DSceneNode[]
  primitives: Pdf3DPrimitive[]
}

interface U3dShadingDescription {
  attributes: number
  textureDimensions: number[]
}

interface U3dMeshDeclaration {
  name: string
  meshAttributes: number
  faceCount: number
  positionCount: number
  normalCount: number
  diffuseColorCount: number
  specularColorCount: number
  textureCoordinateCount: number
  shadings: U3dShadingDescription[]
  minimumResolution: number
  finalMaximumResolution: number
  positionInverseQuant: number
  normalInverseQuant: number
  textureInverseQuant: number
  diffuseInverseQuant: number
  specularInverseQuant: number
}

interface U3dMeshFace {
  shading: number
  positions: [number, number, number]
  normals: [number, number, number]
  diffuse?: [number, number, number]
  specular?: [number, number, number]
  textures: Array<[number, number, number]>
}

interface U3dMeshState {
  declaration: U3dMeshDeclaration
  positions: Pdf3DVector3[]
  normals: Pdf3DVector3[]
  diffuseColors: Array<[number, number, number, number]>
  specularColors: Array<[number, number, number, number]>
  textureCoordinates: Array<[number, number, number, number]>
  faces: U3dMeshFace[]
}

interface U3dMaterialResource {
  name: string
  attributes: number
  diffuse: Pdf3DVector3
  ambient: Pdf3DVector3
  specular: Pdf3DVector3
  emissive: Pdf3DVector3
  reflectivity: number
  opacity: number
}

interface U3dLightResource {
  name: string
  attributes: number
  type: 0 | 1 | 2 | 3
  color: Pdf3DVector3
  attenuation: Pdf3DVector3
  spotAngle: number
  intensity: number
}

interface U3dLitTextureShader {
  name: string
  attributes: number
  alphaReference: number
  alphaCompare: number
  frameBufferBlend: number
  renderPassFlags: number
  channels: number
  alphaTextureChannels: number
  materialName: string
  layers: U3dTextureLayerDefinition[]
}

interface U3dTextureLayerDefinition {
  channel: number
  textureName: string
  intensity: number
  blendFunction: 0 | 1 | 2 | 3
  blendSource: 0 | 1
  blendConstant: number
  textureMode: 0 | 1 | 2 | 3 | 4
  textureTransform: Pdf3DMatrix4
  wrapTransform: Pdf3DMatrix4
  repeat: number
}

interface U3dTextureContinuationFormat {
  compression: 1 | 2 | 3 | 4
  channels: number
  attributes: number
  byteCount: number
  urls: string[]
}

interface U3dTextureResource {
  name: string
  height: number
  width: number
  imageType: number
  formats: U3dTextureContinuationFormat[]
  chunks: Uint8Array[][]
}

interface U3dShadingModifier {
  targetName: string
  chainPosition: number
  attributes: number
  shaderLists: string[][]
}

interface U3dPointLineResource {
  kind: 'points' | 'lines'
  name: string
  elementCount: number
  positionCount: number
  normalCount: number
  diffuseColorCount: number
  specularColorCount: number
  textureCoordinateCount: number
  shadings: U3dShadingDescription[]
  positionInverseQuant: number
  normalInverseQuant: number
  textureInverseQuant: number
  diffuseInverseQuant: number
  specularInverseQuant: number
  positions: Pdf3DVector3[]
  elementPositionIndices: number[]
  diffuseColors: Array<[number, number, number, number]>
  specularColors: Array<[number, number, number, number]>
  textureCoordinates: Array<[number, number, number, number]>
  elementShadings: number[]
  elementDiffuseIndices: number[]
}

class U3dReader {
  private readonly view: DataView
  offset = 0

  constructor(readonly bytes: Uint8Array, readonly label: string) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get remaining(): number { return this.bytes.length - this.offset }

  u8(): number {
    this.require(1)
    return this.bytes[this.offset++]!
  }

  i16(): number {
    this.require(2)
    const value = this.view.getInt16(this.offset, true)
    this.offset += 2
    return value
  }

  u16(): number {
    this.require(2)
    const value = this.view.getUint16(this.offset, true)
    this.offset += 2
    return value
  }

  i32(): number {
    this.require(4)
    const value = this.view.getInt32(this.offset, true)
    this.offset += 4
    return value
  }

  u32(): number {
    this.require(4)
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  u64(): number {
    this.require(8)
    const value = this.view.getBigUint64(this.offset, true)
    this.offset += 8
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${this.label}: 64-bit size exceeds the exact JavaScript integer range`)
    return Number(value)
  }

  f32(): number {
    this.require(4)
    const value = this.view.getFloat32(this.offset, true)
    this.offset += 4
    if (!Number.isFinite(value)) throw new Error(`${this.label}: non-finite F32 value`)
    return value
  }

  f64(): number {
    this.require(8)
    const value = this.view.getFloat64(this.offset, true)
    this.offset += 8
    if (!Number.isFinite(value)) throw new Error(`${this.label}: non-finite F64 value`)
    return value
  }

  string(): string {
    const length = this.u16()
    const bytes = this.take(length)
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (value.length === 0) return value
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      if (code === 0) throw new Error(`${this.label}: U3D strings must not contain NUL`)
    }
    return value
  }

  take(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 0) throw new Error(`${this.label}: invalid byte count`)
    this.require(length)
    const result = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return result
  }

  align4(): void {
    const padding = (4 - (this.offset & 3)) & 3
    for (let index = 0; index < padding; index++) {
      if (this.u8() !== 0) throw new Error(`${this.label}: non-zero alignment padding`)
    }
  }

  finish(): void {
    if (this.remaining !== 0) throw new Error(`${this.label}: ${this.remaining} trailing byte(s)`)
  }

  private require(length: number): void {
    if (this.offset + length > this.bytes.length) throw new Error(`${this.label}: truncated data at byte ${this.offset}`)
  }
}

const U3D_STATIC_CONTEXT_BASE = 0x400
const U3D_MAX_CONTEXT = U3D_STATIC_CONTEXT_BASE + 0x3FFF

class U3dContextManager {
  private readonly frequencies = new Map<number, number[]>()

  frequency(context: number, symbol: number): number {
    if (context >= U3D_STATIC_CONTEXT_BASE || context === 0) return 1
    const values = this.frequencies.get(context)
    if (values === undefined) return symbol === 0 ? 1 : 0
    return values[symbol] ?? 0
  }

  cumulative(context: number, symbol: number): number {
    if (context >= U3D_STATIC_CONTEXT_BASE || context === 0) return symbol - 1
    const values = this.frequencies.get(context)
    if (values === undefined) return 0
    let result = 0
    for (let index = 0; index < symbol; index++) result += values[index] ?? 0
    return result
  }

  total(context: number): number {
    if (context === 0) return 256
    if (context >= U3D_STATIC_CONTEXT_BASE) return context - U3D_STATIC_CONTEXT_BASE
    const values = this.frequencies.get(context)
    if (values === undefined) return 1
    let result = 0
    for (let index = 0; index < values.length; index++) result += values[index]!
    return result
  }

  symbol(context: number, cumulative: number): number {
    if (context >= U3D_STATIC_CONTEXT_BASE || context === 0) return cumulative + 1
    const values = this.frequencies.get(context)
    if (values === undefined || cumulative === 0) return 0
    let sum = 0
    for (let symbol = 0; symbol < values.length; symbol++) {
      sum += values[symbol] ?? 0
      if (cumulative < sum) return symbol
    }
    throw new Error('U3D arithmetic decode error: cumulative frequency is outside its context')
  }

  add(context: number, symbol: number): void {
    if (context >= U3D_STATIC_CONTEXT_BASE || context === 0 || symbol >= 0xFFFF) return
    let values = this.frequencies.get(context)
    if (values === undefined) {
      values = [1]
      this.frequencies.set(context, values)
    }
    let total = 0
    for (let index = 0; index < values.length; index++) total += values[index]!
    if (total >= 0x1FFF) {
      for (let index = 0; index < values.length; index++) values[index] = values[index]! >>> 1
      values[0] = values[0]! + 1
    }
    while (values.length <= symbol) values.push(0)
    values[symbol] = values[symbol]! + 1
  }
}

/** ECMA-363 clause 10 arithmetic reader used by compressed geometry fields. */
class U3dBitReader {
  private readonly view: DataView
  private readonly contexts = new U3dContextManager()
  private bitPosition = 0
  private low = 0
  private high = 0xFFFF
  private underflow = 0

  constructor(readonly bytes: Uint8Array, readonly label: string) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  u8(): number { return reverseByte(this.readSymbol(0) - 1) }
  u16(): number { return this.u8() | (this.u8() << 8) }
  i16(): number { const value = this.u16(); return value < 0x8000 ? value : value - 0x10000 }
  u32(): number { return (this.u16() | (this.u16() << 16)) >>> 0 }
  i32(): number { return this.u32() | 0 }
  u64(): number {
    const low = this.u32()
    const high = this.u32()
    const value = BigInt(low) | (BigInt(high) << 32n)
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${this.label}: 64-bit size exceeds the exact JavaScript integer range`)
    return Number(value)
  }
  f32(): number {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, this.u32(), true)
    const value = new DataView(bytes.buffer).getFloat32(0, true)
    if (!Number.isFinite(value)) throw new Error(`${this.label}: non-finite F32 value`)
    return value
  }
  f64(): number {
    const low = this.u32()
    const high = this.u32()
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, low, true); view.setUint32(4, high, true)
    const value = view.getFloat64(0, true)
    if (!Number.isFinite(value)) throw new Error(`${this.label}: non-finite F64 value`)
    return value
  }
  string(): string {
    const length = this.u16()
    const bytes = new Uint8Array(length)
    for (let index = 0; index < length; index++) bytes[index] = this.u8()
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (value.includes('\0')) throw new Error(`${this.label}: U3D strings must not contain NUL`)
    return value
  }
  compressedU32(context: string | number): number {
    const resolved = typeof context === 'number'
      ? (context >= U3D_MAX_CONTEXT ? 0 : U3D_STATIC_CONTEXT_BASE + context)
      : this.dynamicContext(context)
    if (resolved === 0) return this.u32()
    const symbol = this.readSymbol(resolved)
    if (symbol !== 0) return symbol - 1
    const value = this.u32()
    this.contexts.add(resolved, value + 1)
    return value
  }
  compressedU8(context: string): number {
    const resolved = this.dynamicContext(context)
    const symbol = this.readSymbol(resolved)
    if (symbol !== 0) return symbol - 1
    const value = this.u8()
    this.contexts.add(resolved, value + 1)
    return value
  }
  compressedU16(context: string): number {
    const resolved = this.dynamicContext(context)
    const symbol = this.readSymbol(resolved)
    if (symbol !== 0) return symbol - 1
    const value = this.u16()
    this.contexts.add(resolved, value + 1)
    return value
  }

  private dynamicContext(name: string): number {
    const value = U3D_CONTEXTS[name]
    if (value === undefined) throw new Error(`${this.label}: unknown arithmetic context ${name}`)
    return value
  }

  private readSymbol(context: number): number {
    const savedPosition = this.bitPosition
    let code = this.readBit()
    this.bitPosition += this.underflow
    code = ((code << 15) | this.readMsbBitsFromLsbStream(15)) >>> 0
    this.bitPosition = savedPosition

    const total = this.contexts.total(context)
    const range = this.high + 1 - this.low
    const codeCumulative = Math.floor((total * (1 + code - this.low) - 1) / range)
    const symbol = this.contexts.symbol(context, codeCumulative)
    const cumulative = this.contexts.cumulative(context, symbol)
    const frequency = this.contexts.frequency(context, symbol)
    let low = this.low + Math.floor(range * cumulative / total)
    let high = this.low - 1 + Math.floor(range * (cumulative + frequency) / total)
    this.contexts.add(context, symbol)

    let bitCount = 0
    while ((low & 0x8000) === (high & 0x8000)) {
      low = (low & 0x7FFF) << 1
      high = ((high & 0x7FFF) << 1) | 1
      bitCount++
    }
    if (bitCount > 0) {
      bitCount += this.underflow
      this.underflow = 0
    }
    while ((low & 0x4000) !== 0 && (high & 0x4000) === 0) {
      low = (low & 0x3FFF) << 1
      high = ((high & 0x3FFF) << 1) | 0x8001
      this.underflow++
    }
    this.low = low & 0xFFFF
    this.high = high & 0xFFFF
    this.bitPosition += bitCount
    return symbol
  }

  private readBit(): number {
    const byteIndex = this.bitPosition >>> 3
    const value = byteIndex < this.bytes.length ? (this.bytes[byteIndex]! >>> (this.bitPosition & 7)) & 1 : 0
    this.bitPosition++
    return value
  }

  private readMsbBitsFromLsbStream(count: number): number {
    let value = 0
    for (let index = 0; index < count; index++) value = (value << 1) | this.readBit()
    return value
  }
}

const U3D_CONTEXTS: Readonly<Record<string, number>> = {
  cFaceCnt: 1,
  cPointCnt: 1,
  cLineCnt: 1,
  cBaseShading: 1,
  cShading: 65,
  cFaceOrnt: 2,
  cThrdPosType: 3,
  cLocal3rdPos: 4,
  cStayMove0: 15,
  cStayMove1: 16,
  cStayMove2: 17,
  cStayMove3: 18,
  cStayMove4: 19,
  cPosDiffSign: 20,
  cPosDiffX: 21,
  cPosDiffY: 22,
  cPosDiffZ: 23,
  cTexCoordSign: 32,
  cTexCDiff0: 33,
  cTexCDiff1: 34,
  cTexCDiff2: 35,
  cTexCDiff3: 36,
  cTexCDup: 39,
  cNormlCnt: 40,
  cDiffNormalSign: 41,
  cDiffNormalX: 42,
  cDiffNormalY: 43,
  cDiffNormalZ: 44,
  cNormlIdx: 45,
  cDiffuseCount: 99,
  cDiffuseColorSign: 100,
  cSpecularCount: 101,
  cSpecularColorSign: 102,
  cDiffuseKeepChange: 104,
  cDiffuseChangeType: 105,
  cDiffuseChangeIndexNew: 106,
  cDiffuseChangeIndexLocal: 107,
  cDiffuseChangeIndexGlobal: 108,
  cSpecularKeepChange: 109,
  cSpecularChangeType: 110,
  cSpecularChangeIndexNew: 111,
  cSpecularChangeIndexLocal: 112,
  cSpecularChangeIndexGlobal: 113,
  cTCKeepChange: 114,
  cTCChangeType: 115,
  cTCChangeIndexNew: 116,
  cTCChangeIndexLocal: 117,
  cTCChangeIndexGlobal: 118,
  cColorIndexLocal: 119,
  cColorIndexGlobal: 120,
  cTextureIndexLocal: 121,
  cTextureIndexGlobal: 122,
  cTexCoordCount: 123,
  cColorDup: 56,
  cColorIndexType: 55,
  cTextureIndexType: 29,
  cColorDiff0: 60,
  cColorDiff1: 61,
  cColorDiff2: 62,
  cColorDiff3: 63,
}

function reverseByte(value: number): number {
  let result = value & 0xFF
  result = ((result & 0x55) << 1) | ((result >>> 1) & 0x55)
  result = ((result & 0x33) << 2) | ((result >>> 2) & 0x33)
  return ((result & 0x0F) << 4) | (result >>> 4)
}

/** Decodes the ECMA-363 block stream and its scene/view semantics. */
export function decodeU3dScene(data: Uint8Array, options: U3dDecodeOptions = {}): Pdf3DScene {
  if (data.length < 12) throw new Error('U3D decode error: file is shorter than one block header')
  const blocks = readU3dBlocks(data, 0, data.length, 'U3D file')
  if (blocks.length === 0 || blocks[0]!.type !== U3D_FILE_HEADER) throw new Error('U3D decode error: first block must be the File Header')
  const header = readU3dHeader(blocks[0]!, data.length)
  const declarationEnd = header.declarationSize
  if (declarationEnd < blocks[0]!.byteLength || declarationEnd > data.length) throw new Error('U3D decode error: Declaration Size is outside the file')
  if (declarationEnd !== data.length && !blocks.some(function (block) { return block.offset + block.byteLength === declarationEnd })) {
    throw new Error('U3D decode error: Declaration Size does not end on a block boundary')
  }

  const nodes = new Map<string, Pdf3DSceneNode>()
  const modifierChains: U3dModifierChain[] = []
  const meshDeclarations = new Map<string, U3dMeshDeclaration>()
  const pointLineResources = new Map<string, U3dPointLineResource>()
  const materials = new Map<string, U3dMaterialResource>()
  const lightResources = new Map<string, U3dLightResource>()
  const textureResources = new Map<string, U3dTextureResource>()
  const shaders = new Map<string, U3dLitTextureShader>()
  const shadingModifiers = new Map<string, U3dShadingModifier>()
  function readDeclarationBlock(block: U3dBlock): void {
    const node = readNode(block)
    if (node !== null) nodes.set(node.name, node)
    if (block.type === U3D_CLOD_MESH_DECLARATION) {
      const declaration = readMeshDeclaration(block)
      if (meshDeclarations.has(declaration.name)) throw new Error(`U3D decode error: duplicate mesh declaration ${JSON.stringify(declaration.name)}`)
      meshDeclarations.set(declaration.name, declaration)
    } else if (block.type === U3D_POINT_SET_DECLARATION || block.type === U3D_LINE_SET_DECLARATION) {
      const resource = readPointLineDeclaration(block)
      if (pointLineResources.has(resource.name)) throw new Error(`U3D decode error: duplicate geometry declaration ${JSON.stringify(resource.name)}`)
      pointLineResources.set(resource.name, resource)
    } else if (block.type === U3D_MATERIAL_RESOURCE) {
      const material = readMaterialResource(block)
      if (materials.has(material.name)) throw new Error(`U3D decode error: duplicate material resource ${JSON.stringify(material.name)}`)
      materials.set(material.name, material)
    } else if (block.type === U3D_LIGHT_RESOURCE) {
      const light = readLightResource(block)
      if (lightResources.has(light.name)) throw new Error(`U3D decode error: duplicate light resource ${JSON.stringify(light.name)}`)
      lightResources.set(light.name, light)
    } else if (block.type === U3D_TEXTURE_DECLARATION) {
      const texture = readTextureDeclaration(block)
      if (textureResources.has(texture.name)) throw new Error(`U3D decode error: duplicate texture resource ${JSON.stringify(texture.name)}`)
      textureResources.set(texture.name, texture)
    } else if (block.type === U3D_LIT_TEXTURE_SHADER) {
      const shader = readLitTextureShader(block)
      if (shaders.has(shader.name)) throw new Error(`U3D decode error: duplicate shader resource ${JSON.stringify(shader.name)}`)
      shaders.set(shader.name, shader)
    } else if (block.type === U3D_SHADING_MODIFIER) {
      const modifier = readShadingModifier(block)
      if (shadingModifiers.has(modifier.targetName)) throw new Error(`U3D decode error: duplicate shading modifier for ${JSON.stringify(modifier.targetName)}`)
      shadingModifiers.set(modifier.targetName, modifier)
    }
  }
  for (let index = 1; index < blocks.length; index++) {
    const block = blocks[index]!
    if (block.offset >= declarationEnd) continue
    if (block.type === U3D_MODIFIER_CHAIN) {
      const chain = readModifierChain(block, header)
      modifierChains.push(chain)
      for (let nestedIndex = 0; nestedIndex < chain.modifierBlocks.length; nestedIndex++) {
        readDeclarationBlock(chain.modifierBlocks[nestedIndex]!)
      }
      continue
    }
    readDeclarationBlock(block)
  }
  const meshStates = new Map<string, U3dMeshState>()
  for (let index = 1; index < blocks.length; index++) {
    const block = blocks[index]!
    if (block.type !== U3D_CLOD_BASE_MESH_CONTINUATION) continue
    const state = readBaseMeshContinuation(block, meshDeclarations)
    if (meshStates.has(state.declaration.name)) throw new Error(`U3D decode error: duplicate base mesh for ${JSON.stringify(state.declaration.name)}`)
    meshStates.set(state.declaration.name, state)
  }
  for (const declaration of meshDeclarations.values()) {
    if (meshStates.has(declaration.name)) continue
    meshStates.set(declaration.name, {
      declaration, positions: [], normals: [], diffuseColors: [], specularColors: [], textureCoordinates: [], faces: [],
    })
  }
  for (let index = 1; index < blocks.length; index++) {
    const block = blocks[index]!
    if (block.type === U3D_CLOD_PROGRESSIVE_MESH_CONTINUATION) readProgressiveMeshContinuation(block, meshStates)
  }
  for (const state of meshStates.values()) {
    if (state.positions.length !== state.declaration.finalMaximumResolution || state.faces.length !== state.declaration.faceCount) {
      throw new Error(`U3D decode error: mesh ${JSON.stringify(state.declaration.name)} does not reach its declared final resolution`)
    }
  }
  for (let index = 1; index < blocks.length; index++) {
    const block = blocks[index]!
    if (block.type === U3D_POINT_SET_CONTINUATION || block.type === U3D_LINE_SET_CONTINUATION) {
      readPointLineContinuation(block, pointLineResources)
    }
    if (block.type === U3D_TEXTURE_CONTINUATION) readTextureContinuation(block, textureResources)
  }
  const textures = new Map<string, Pdf3DTextureImage>()
  for (const resource of textureResources.values()) textures.set(resource.name, decodeU3dTexture(resource, options.resolveExternalTexture))
  const primitives: Pdf3DPrimitive[] = []
  for (const state of meshStates.values()) primitives.push(meshStatePrimitive(state, shadingModifiers.get(state.declaration.name), shaders, materials, textures))
  for (const resource of pointLineResources.values()) {
    if (resource.positions.length !== resource.positionCount || resource.elementPositionIndices.length !== resource.elementCount * (resource.kind === 'lines' ? 2 : 1)) {
      throw new Error(`U3D decode error: ${resource.kind} resource ${JSON.stringify(resource.name)} is incomplete`)
    }
    if (resource.kind === 'points') {
      primitives.push({
        kind: 'points', name: resource.name,
        positions: resource.elementPositionIndices.map(function (index) { return resource.positions[index]! }),
        ...(resource.elementDiffuseIndices.length === 0 ? {} : { colors: resource.elementDiffuseIndices.map(function (index) { return resource.diffuseColors[index]! }) }),
      })
    } else {
      if (resource.elementDiffuseIndices.length === 0) primitives.push({ kind: 'lines', name: resource.name, positions: resource.positions, indices: resource.elementPositionIndices })
      else {
        const positions = resource.elementPositionIndices.map(function (index) { return resource.positions[index]! })
        primitives.push({
          kind: 'lines', name: resource.name, positions, indices: positions.map(function (_point, index) { return index }),
          colors: resource.elementDiffuseIndices.map(function (index) { return resource.diffuseColors[index]! }),
        })
      }
    }
  }
  validateNodeGraph(nodes)
  const lights: Pdf3DLightSource[] = []
  for (const node of nodes.values()) {
    if (node.kind !== 'light') continue
    const resource = lightResources.get(node.resourceName)
    if (resource === undefined) throw new Error(`U3D decode error: light node ${JSON.stringify(node.name)} references missing resource ${JSON.stringify(node.resourceName)}`)
    lights.push({
      name: resource.name, nodeName: node.name,
      type: (['ambient', 'directional', 'point', 'spot'] as const)[resource.type],
      enabled: (resource.attributes & 1) !== 0, specular: (resource.attributes & 2) !== 0,
      color: resource.color, attenuation: resource.attenuation, spotAngle: resource.spotAngle, intensity: resource.intensity,
    })
  }
  const declaredBounds = combineBounds(modifierChains)
  const geometryBounds = calculatePdf3DSceneBounds({ nodes: [...nodes.values()], primitives })
  const bounds = declaredBounds === null ? geometryBounds : geometryBounds === null ? declaredBounds : unionBounds(declaredBounds, geometryBounds)
  return { format: 'U3D', header, blocks, nodes: [...nodes.values()], modifierChains, primitives, bounds, ...(lights.length === 0 ? {} : { lights }) }
}

/** Measures a scene-space segment and applies the U3D defined-units scale when present. */
export function measurePdf3DScene(scene: Pdf3DDecodedScene, start: Pdf3DVector3, end: Pdf3DVector3): Pdf3DMeasurement {
  validatePoint(start, 'start')
  validatePoint(end, 'end')
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const dz = end[2] - start[2]
  const sourceUnits = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const units = scene.format === 'U3D' ? scene.header.unitsInMeters : scene.unitsInMeters
  return { sourceUnits, metres: units === null ? null : sourceUnits * units }
}

/** Creates the normal-appearance poster used while a PDF 3D annotation is inactive. */
export function renderPdf3DPoster(scene: Pdf3DDecodedScene, width: number, height: number): Pdf3DPoster {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('PDF 3D poster dimensions must be positive finite numbers')
  }
  const instances = collectPrimitiveInstances(scene)
  const background = scene.backgroundColor ?? [0.97, 0.97, 0.97]
  const backgroundOperator = `${pdfNumber(clampUnit(background[0]))} ${pdfNumber(clampUnit(background[1]))} ${pdfNumber(clampUnit(background[2]))} rg`
  const bounds = scene.bounds
  if (bounds === null) {
    if (instances.length !== 0) throw new Error('PDF 3D poster requires decoded scene bounds')
    return { width, height, content: ['q', backgroundOperator, `0 0 ${pdfNumber(width)} ${pdfNumber(height)} re f`, 'Q'].join('\n') }
  }
  const min = bounds.minimum
  const max = bounds.maximum
  if (min[0] > max[0] || min[1] > max[1] || min[2] > max[2]) throw new Error('PDF 3D scene bounds are inverted')
  const projection = posterProjection(scene)
  const boundsCorners: Pdf3DVector3[] = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ]
  const fitPoints = instances.length === 0
    ? boundsCorners
    : instances.flatMap(function (instance) { return instance.positions })
  const projected = fitPoints.map(projection.point)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let index = 0; index < projected.length; index++) {
    const point = projected[index]!
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1])
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1])
  }
  const spanX = maxX - minX
  const spanY = maxY - minY
  const margin = Math.min(width, height) * 0.1
  const scale = Math.min((width - margin * 2) / (spanX === 0 ? 1 : spanX), (height - margin * 2) / (spanY === 0 ? 1 : spanY))
  const offsetX = (width - spanX * scale) / 2 - minX * scale
  const offsetY = (height - spanY * scale) / 2 - minY * scale
  const lineWidth = Math.max(0.5, Math.min(width, height) / 220)
  const ops = ['q', backgroundOperator, `0 0 ${pdfNumber(width)} ${pdfNumber(height)} re f`, `${pdfNumber(lineWidth)} w`]
  const posterFonts = new Map<string, string>()
  if (instances.length === 0) {
    const boxProjection = boundsCorners.map(projection.point)
    const edges: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    ops.push('0.18 0.28 0.42 RG')
    for (let index = 0; index < edges.length; index++) {
      const edge = edges[index]!
      appendPosterLine(ops, boxProjection[edge[0]]!, boxProjection[edge[1]]!, scale, offsetX, offsetY)
    }
  } else {
    appendPrimitivePoster(ops, instances, scale, offsetX, offsetY, lineWidth, projection, scene, width, height, posterFonts)
  }
  ops.push('Q')
  const resources = posterFonts.size === 0 ? undefined : `<< /Font << ${[...posterFonts].map(function (entry) { return `/${entry[1]} << /Type /Font /Subtype /Type1 /BaseFont /${entry[0]} /Encoding /WinAnsiEncoding >>` }).join(' ')} >> >>`
  return { width, height, content: ops.join('\n'), ...(resources === undefined ? {} : { resources }) }
}

interface Pdf3DPrimitiveInstance {
  primitive: Pdf3DPrimitive
  positions: Pdf3DVector3[]
  normals?: Pdf3DVector3[]
  color?: [number, number, number, number]
  surface?: Pdf3DSurfaceMaterial
  renderPasses?: Pdf3DRenderPass[]
}

function collectPrimitiveInstances(scene: Pdf3DSceneGeometry): Pdf3DPrimitiveInstance[] {
  const nodeMap = new Map<string, Pdf3DSceneNode>()
  for (let index = 0; index < scene.nodes.length; index++) nodeMap.set(scene.nodes[index]!.name, scene.nodes[index]!)
  const hasSceneHierarchy = scene.nodes.some(function (node) { return node.kind === 'group' || node.kind === 'model' })
  const result: Pdf3DPrimitiveInstance[] = []
  for (let primitiveIndex = 0; primitiveIndex < scene.primitives.length; primitiveIndex++) {
    const primitive = scene.primitives[primitiveIndex]!
    const models = scene.nodes.filter(function (node): node is Pdf3DModelNode {
      return node.kind === 'model' && node.resourceName === primitive.name && node.visibility !== 1
    })
    if (models.length === 0) {
      if (!hasSceneHierarchy) result.push({
        primitive, positions: primitive.positions,
        ...(primitive.kind === 'triangles' && primitive.normals !== undefined ? { normals: primitive.normals } : {}),
      })
      continue
    }
    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
      const matrices = nodeWorldMatrices(models[modelIndex]!, nodeMap, new Set<string>())
      for (let matrixIndex = 0; matrixIndex < matrices.length; matrixIndex++) {
        const matrix = matrices[matrixIndex]!
        result.push({
          primitive,
          positions: primitive.positions.map(function (point) { return transformPoint(matrix, point) }),
          ...(primitive.kind === 'triangles' && primitive.normals !== undefined
            ? { normals: primitive.normals.map(function (normal) { return transformNormal(matrix, normal) }) }
            : {}),
          color: models[modelIndex]!.color,
          surface: models[modelIndex]!.surface,
          renderPasses: models[modelIndex]!.renderPasses,
        })
      }
    }
  }
  return result
}

/** Returns world-space geometry bounds after applying all model and parent transforms. */
export function calculatePdf3DSceneBounds(scene: Pdf3DSceneGeometry): Pdf3DBoundingBox | null {
  const instances = collectPrimitiveInstances(scene)
  let result: Pdf3DBoundingBox | null = null
  for (let instanceIndex = 0; instanceIndex < instances.length; instanceIndex++) {
    const positions = instances[instanceIndex]!.positions
    for (let pointIndex = 0; pointIndex < positions.length; pointIndex++) {
      const point = positions[pointIndex]!
      if (result === null) result = { minimum: [...point] as Pdf3DVector3, maximum: [...point] as Pdf3DVector3 }
      else for (let axis = 0; axis < 3; axis++) {
        result.minimum[axis] = Math.min(result.minimum[axis]!, point[axis]!)
        result.maximum[axis] = Math.max(result.maximum[axis]!, point[axis]!)
      }
    }
  }
  return result
}

function nodeWorldMatrices(node: Pdf3DSceneNode, nodes: Map<string, Pdf3DSceneNode>, active: Set<string>): Pdf3DMatrix4[] {
  if (active.has(node.name)) throw new Error(`U3D decode error: recursive transform at ${JSON.stringify(node.name)}`)
  active.add(node.name)
  const result: Pdf3DMatrix4[] = []
  if (node.parents.length === 0) result.push(identityMatrix())
  for (let index = 0; index < node.parents.length; index++) {
    const relation = node.parents[index]!
    const parent = nodes.get(relation.name)
    if (parent === undefined) result.push(relation.matrix)
    else {
      const parentMatrices = nodeWorldMatrices(parent, nodes, active)
      for (let parentIndex = 0; parentIndex < parentMatrices.length; parentIndex++) {
        result.push(multiplyMatrices(parentMatrices[parentIndex]!, relation.matrix))
      }
    }
  }
  active.delete(node.name)
  return result
}

function appendPrimitivePoster(
  ops: string[],
  instances: Pdf3DPrimitiveInstance[],
  scale: number,
  offsetX: number,
  offsetY: number,
  lineWidth: number,
  projection: Pdf3DPosterProjection,
  scene: Pdf3DDecodedScene,
  width: number,
  height: number,
  posterFonts: Map<string, string>,
): void {
  const triangles: Array<{ points: [Pdf3DVector3, Pdf3DVector3, Pdf3DVector3], color: [number, number, number, number], depth: number }> = []
  const rasterTriangles = (scene.clippingPlanes?.length ?? 0) > 0 || instances.some(function (instance) { return instance.primitive.kind === 'triangles' && (instance.primitive.faceRenderPasses !== undefined || instance.renderPasses !== undefined) })
  for (let instanceIndex = 0; instanceIndex < instances.length; instanceIndex++) {
    const instance = instances[instanceIndex]!
    const primitive = instance.primitive
    if (primitive.kind !== 'triangles' || rasterTriangles) continue
    for (let index = 0; index + 2 < primitive.indices.length; index += 3) {
      const ia = primitive.indices[index]!, ib = primitive.indices[index + 1]!, ic = primitive.indices[index + 2]!
      const a = instance.positions[ia], b = instance.positions[ib], c = instance.positions[ic]
      if (a === undefined || b === undefined || c === undefined) throw new Error(`PDF 3D primitive ${JSON.stringify(primitive.name)} has an invalid triangle index`)
      const ca = instance.color ?? primitive.colors?.[ia] ?? [0.32, 0.52, 0.76, 1]
      const cb = instance.color ?? primitive.colors?.[ib] ?? ca
      const cc = instance.color ?? primitive.colors?.[ic] ?? ca
      const faceNormal = triangleNormal(a, b, c, primitive.name)
      const shadedA = shadePosterVertex(scene, a, instance.normals?.[ia] ?? faceNormal, instance.surface ?? primitive.surfaces?.[ia], ca)
      const shadedB = shadePosterVertex(scene, b, instance.normals?.[ib] ?? faceNormal, instance.surface ?? primitive.surfaces?.[ib], cb)
      const shadedC = shadePosterVertex(scene, c, instance.normals?.[ic] ?? faceNormal, instance.surface ?? primitive.surfaces?.[ic], cc)
      triangles.push({
        points: [a, b, c],
        color: [(shadedA[0] + shadedB[0] + shadedC[0]) / 3, (shadedA[1] + shadedB[1] + shadedC[1]) / 3, (shadedA[2] + shadedB[2] + shadedC[2]) / 3, (shadedA[3] + shadedB[3] + shadedC[3]) / 3],
        depth: projection.depth(a) + projection.depth(b) + projection.depth(c),
      })
    }
  }
  if (rasterTriangles) appendRasterizedTrianglePoster(ops, instances, scene, projection, scale, offsetX, offsetY, width, height)
  triangles.sort(function (a, b) { return a.depth - b.depth })
  ops.push('0.12 0.18 0.25 RG')
  for (let index = 0; index < triangles.length; index++) {
    const triangle = triangles[index]!
    const a = posterCoordinate(triangle.points[0], scale, offsetX, offsetY, projection)
    const b = posterCoordinate(triangle.points[1], scale, offsetX, offsetY, projection)
    const c = posterCoordinate(triangle.points[2], scale, offsetX, offsetY, projection)
      const color = triangle.color
    const opaque = posterOpaqueColor(color)
    ops.push(`${pdfNumber(opaque[0])} ${pdfNumber(opaque[1])} ${pdfNumber(opaque[2])} rg`)
    ops.push(`${pdfNumber(a[0])} ${pdfNumber(a[1])} m ${pdfNumber(b[0])} ${pdfNumber(b[1])} l ${pdfNumber(c[0])} ${pdfNumber(c[1])} l h B`)
  }
  ops.push(`${pdfNumber(Math.max(lineWidth, 0.75))} w`, '0.16 0.24 0.34 RG')
  for (let instanceIndex = 0; instanceIndex < instances.length; instanceIndex++) {
    const instance = instances[instanceIndex]!
    const primitive = instance.primitive
    if (primitive.kind === 'lines') {
      if (primitive.lineWidth !== undefined) ops.push(`${pdfNumber(Math.max(0.1, primitive.lineWidth))} w`)
      for (let index = 0; index + 1 < primitive.indices.length; index += 2) {
        const ia = primitive.indices[index]!, ib = primitive.indices[index + 1]!
        let a = instance.positions[ia], b = instance.positions[ib]
        if (a === undefined || b === undefined) throw new Error(`PDF 3D primitive ${JSON.stringify(primitive.name)} has an invalid line index`)
        const clipped = clipPosterSegment(a, b, scene.clippingPlanes ?? [])
        if (clipped === null) continue
        a = clipped[0]; b = clipped[1]
        const ca = instance.color ?? primitive.colors?.[ia] ?? [0.16, 0.24, 0.34, 1]
        const cb = primitive.colors?.[ib] ?? ca
        const color = posterOpaqueColor([(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2, (ca[3] + cb[3]) / 2])
        ops.push(`${pdfNumber(color[0])} ${pdfNumber(color[1])} ${pdfNumber(color[2])} RG`)
        appendPosterLine(ops, projection.point(a), projection.point(b), scale, offsetX, offsetY)
      }
      if (primitive.lineWidth !== undefined) ops.push(`${pdfNumber(Math.max(lineWidth, 0.75))} w`)
    } else if (primitive.kind === 'points') {
      const radius = Math.max(1.2, lineWidth * 1.5)
      for (let index = 0; index < instance.positions.length; index++) {
        if (!pointInsideClippingPlanes(instance.positions[index]!, scene.clippingPlanes ?? [])) continue
        const point = posterCoordinate(instance.positions[index]!, scale, offsetX, offsetY, projection)
        const color = posterOpaqueColor(instance.color ?? primitive.colors?.[index] ?? [0.16, 0.24, 0.34, 1])
        ops.push(`${pdfNumber(color[0])} ${pdfNumber(color[1])} ${pdfNumber(color[2])} rg`)
        ops.push(`${pdfNumber(point[0] - radius)} ${pdfNumber(point[1] - radius)} ${pdfNumber(radius * 2)} ${pdfNumber(radius * 2)} re f`)
      }
    } else if (primitive.kind === 'text') {
      appendPosterText(ops, instance, primitive, scale, offsetX, offsetY, projection, posterFonts)
    }
  }
}

function appendPosterText(
  ops: string[],
  instance: Pdf3DPrimitiveInstance,
  primitive: Pdf3DTextPrimitive,
  scale: number,
  offsetX: number,
  offsetY: number,
  projection: Pdf3DPosterProjection,
  posterFonts: Map<string, string>,
): void {
  const canonical = prcPosterFont(primitive.fontFamily, primitive.fontAttributes)
  const metrics = getStandardFontMetrics(canonical)!
  let resourceName = posterFonts.get(canonical)
  if (resourceName === undefined) { resourceName = `F3D${posterFonts.size}`; posterFonts.set(canonical, resourceName) }
  const encoded: number[] = []
  let unitWidth = 0
  for (const character of primitive.text) {
    const code = winAnsiCodeForCodePoint(character.codePointAt(0)!)
    if (code === null) throw new Error(`PRC markup text contains a character unavailable in ${canonical}`)
    encoded.push(code); unitWidth += metrics.widths[code]!
  }
  if (unitWidth <= 0) throw new Error('PRC markup text has no measurable glyph width')
  const origin = posterCoordinate(instance.positions[0]!, scale, offsetX, offsetY, projection)
  const xEnd = posterCoordinate(instance.positions[1]!, scale, offsetX, offsetY, projection)
  const yEnd = posterCoordinate(instance.positions[2]!, scale, offsetX, offsetY, projection)
  const xAxis: [number, number] = [xEnd[0] - origin[0], xEnd[1] - origin[1]]
  const yAxis: [number, number] = [yEnd[0] - origin[0], yEnd[1] - origin[1]]
  const textScale = 1000 / unitWidth
  const color = primitive.color ?? instance.color ?? [0.16, 0.24, 0.34, 1]
  const opaque = posterOpaqueColor(color)
  let hex = ''
  for (let index = 0; index < encoded.length; index++) hex += encoded[index]!.toString(16).padStart(2, '0').toUpperCase()
  ops.push(
    'BT', `${pdfNumber(opaque[0])} ${pdfNumber(opaque[1])} ${pdfNumber(opaque[2])} rg`, `/${resourceName} 1 Tf`,
    `${pdfNumber(xAxis[0] * textScale)} ${pdfNumber(xAxis[1] * textScale)} ${pdfNumber(yAxis[0])} ${pdfNumber(yAxis[1])} ${pdfNumber(origin[0])} ${pdfNumber(origin[1])} Tm`,
    `<${hex}> Tj`, 'ET',
  )
  const decoration = primitive.fontAttributes & (8 | 16 | 32)
  if (decoration !== 0) {
    ops.push(`${pdfNumber(Math.max(0.5, Math.hypot(yAxis[0], yAxis[1]) / 18))} w`, `${pdfNumber(opaque[0])} ${pdfNumber(opaque[1])} ${pdfNumber(opaque[2])} RG`)
    if ((decoration & 8) !== 0) appendTextDecoration(ops, origin, xAxis, yAxis, 0.08)
    if ((decoration & 16) !== 0) appendTextDecoration(ops, origin, xAxis, yAxis, 0.45)
    if ((decoration & 32) !== 0) appendTextDecoration(ops, origin, xAxis, yAxis, 0.92)
  }
}

function appendTextDecoration(ops: string[], origin: [number, number], xAxis: [number, number], yAxis: [number, number], amount: number): void {
  const start: [number, number] = [origin[0] + yAxis[0] * amount, origin[1] + yAxis[1] * amount]
  ops.push(`${pdfNumber(start[0])} ${pdfNumber(start[1])} m ${pdfNumber(start[0] + xAxis[0])} ${pdfNumber(start[1] + xAxis[1])} l S`)
}

function prcPosterFont(family: string, attributes: number): string {
  const resolved = resolveStandardFontName(family)
  let root = resolved ?? 'Helvetica'
  if (root.startsWith('Helvetica')) root = 'Helvetica'
  else if (root.startsWith('Times')) root = 'Times'
  else if (root.startsWith('Courier')) root = 'Courier'
  else return root
  const bold = (attributes & 2) !== 0, italic = (attributes & 4) !== 0
  if (root === 'Times') return bold ? italic ? 'Times-BoldItalic' : 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman'
  return bold ? italic ? `${root}-BoldOblique` : `${root}-Bold` : italic ? `${root}-Oblique` : root
}

interface RasterTriangle {
  instance: Pdf3DPrimitiveInstance
  primitive: Pdf3DTrianglePrimitive
  face: number
  indices: [number, number, number]
  points: [Pdf3DVector3, Pdf3DVector3, Pdf3DVector3]
  screen: [[number, number], [number, number], [number, number]]
  depth: number
}

function appendRasterizedTrianglePoster(
  ops: string[],
  instances: Pdf3DPrimitiveInstance[],
  scene: Pdf3DDecodedScene,
  projection: Pdf3DPosterProjection,
  scale: number,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): void {
  const pixelWidth = Math.max(1, Math.ceil(width)), pixelHeight = Math.max(1, Math.ceil(height))
  const background = scene.backgroundColor ?? [0.97, 0.97, 0.97]
  const pixels = new Uint8Array(pixelWidth * pixelHeight * 3)
  for (let pixel = 0; pixel < pixelWidth * pixelHeight; pixel++) {
    pixels[pixel * 3] = Math.round(clampUnit(background[0]) * 255)
    pixels[pixel * 3 + 1] = Math.round(clampUnit(background[1]) * 255)
    pixels[pixel * 3 + 2] = Math.round(clampUnit(background[2]) * 255)
  }
  const depthBuffer = new Float64Array(pixelWidth * pixelHeight)
  depthBuffer.fill(-Infinity)
  const triangles: RasterTriangle[] = []
  for (let instanceIndex = 0; instanceIndex < instances.length; instanceIndex++) {
    const instance = instances[instanceIndex]!
    if (instance.primitive.kind !== 'triangles') continue
    const primitive = instance.primitive
    for (let offset = 0; offset + 2 < primitive.indices.length; offset += 3) {
      const indices: [number, number, number] = [primitive.indices[offset]!, primitive.indices[offset + 1]!, primitive.indices[offset + 2]!]
      const a = instance.positions[indices[0]], b = instance.positions[indices[1]], c = instance.positions[indices[2]]
      if (a === undefined || b === undefined || c === undefined) throw new Error(`PDF 3D primitive ${JSON.stringify(primitive.name)} has an invalid triangle index`)
      triangles.push({
        instance, primitive, face: offset / 3, indices, points: [a, b, c],
        screen: [posterCoordinate(a, scale, offsetX, offsetY, projection), posterCoordinate(b, scale, offsetX, offsetY, projection), posterCoordinate(c, scale, offsetX, offsetY, projection)],
        depth: (projection.depth(a) + projection.depth(b) + projection.depth(c)) / 3,
      })
    }
  }
  triangles.sort(function (a, b) { return a.depth - b.depth })
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex++) rasterizePosterTriangle(triangles[triangleIndex]!, scene, projection, pixels, depthBuffer, pixelWidth, pixelHeight)
  let hex = ''
  const alphabet = '0123456789ABCDEF'
  for (let row = pixelHeight - 1; row >= 0; row--) {
    for (let x = 0; x < pixelWidth; x++) {
      const offset = (row * pixelWidth + x) * 3
      for (let channel = 0; channel < 3; channel++) {
        const value = pixels[offset + channel]!
        hex += alphabet[value >>> 4]! + alphabet[value & 15]!
      }
    }
  }
  ops.push('q', `${pdfNumber(width)} 0 0 ${pdfNumber(height)} 0 0 cm`, `BI /W ${pixelWidth} /H ${pixelHeight} /CS /RGB /BPC 8 /F /AHx ID`, `${hex}>`, 'EI', 'Q')
}

function rasterizePosterTriangle(
  triangle: RasterTriangle,
  scene: Pdf3DDecodedScene,
  projection: Pdf3DPosterProjection,
  pixels: Uint8Array,
  depthBuffer: Float64Array,
  width: number,
  height: number,
): void {
  const p = triangle.screen
  const area = edgeFunction(p[0], p[1], p[2])
  if (Math.abs(area) <= Number.EPSILON) return
  const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])))
  const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])))
  const maxY = Math.min(height - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])))
  const weights = triangle.points.map(projection.weight) as [number, number, number]
  const primitive = triangle.primitive
  const faceNormal = triangleNormal(triangle.points[0], triangle.points[1], triangle.points[2], primitive.name)
  const baseColors = triangle.indices.map(function (index, corner) {
    const fallback = triangle.instance.color ?? primitive.colors?.[index] ?? [0.32, 0.52, 0.76, 1]
    return shadePosterVertex(scene, triangle.points[corner]!, triangle.instance.normals?.[index] ?? faceNormal, triangle.instance.surface ?? primitive.surfaces?.[index], fallback)
  }) as [[number, number, number, number], [number, number, number, number], [number, number, number, number]]
  const passes = triangle.instance.renderPasses ?? primitive.faceRenderPasses?.[triangle.face] ?? []
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const sample: [number, number] = [x + 0.5, y + 0.5]
    const barycentric: [number, number, number] = [edgeFunction(p[1], p[2], sample) / area, edgeFunction(p[2], p[0], sample) / area, edgeFunction(p[0], p[1], sample) / area]
    if (barycentric[0] < -1e-9 || barycentric[1] < -1e-9 || barycentric[2] < -1e-9) continue
    const perspective = perspectiveBarycentric(barycentric, weights)
    const worldPoint: Pdf3DVector3 = [
      perspective[0] * triangle.points[0][0] + perspective[1] * triangle.points[1][0] + perspective[2] * triangle.points[2][0],
      perspective[0] * triangle.points[0][1] + perspective[1] * triangle.points[1][1] + perspective[2] * triangle.points[2][1],
      perspective[0] * triangle.points[0][2] + perspective[1] * triangle.points[1][2] + perspective[2] * triangle.points[2][2],
    ]
    if (!pointInsideClippingPlanes(worldPoint, scene.clippingPlanes ?? [])) continue
    const depth = perspective[0] * projection.depth(triangle.points[0]) + perspective[1] * projection.depth(triangle.points[1]) + perspective[2] * projection.depth(triangle.points[2])
    const pixelIndex = y * width + x
    if (depth < depthBuffer[pixelIndex]!) continue
    const destination: [number, number, number, number] = [pixels[pixelIndex * 3]! / 255, pixels[pixelIndex * 3 + 1]! / 255, pixels[pixelIndex * 3 + 2]! / 255, 1]
    let output = destination
    if (passes.length === 0) output = interpolateColor(baseColors, perspective)
    else for (let passIndex = 0; passIndex < passes.length; passIndex++) {
      const pass = passes[passIndex]!
      let source = interpolateColor(baseColors, perspective)
      source = [source[0], source[1], source[2], pass.material.opacity]
      for (let layerIndex = 0; layerIndex < pass.layers.length; layerIndex++) {
        const layer = pass.layers[layerIndex]!
        const uv = textureCoordinatesForFragment(triangle, layer, perspective)
        const sampled = sampleTexture(layer, uv)
        if (sampled === null) continue
        if ((pass.alphaTextureChannels & (1 << layer.channel)) === 0) sampled[3] = 1
        source = blendTextureLayer(source, sampled, layer)
      }
      if (!u3dAlphaTest(source[3], pass.alphaReference, pass.alphaCompare)) continue
      output = compositeU3dShaderPass(output, source, pass.frameBufferBlend)
    }
    pixels[pixelIndex * 3] = Math.round(clampUnit(output[0]) * 255)
    pixels[pixelIndex * 3 + 1] = Math.round(clampUnit(output[1]) * 255)
    pixels[pixelIndex * 3 + 2] = Math.round(clampUnit(output[2]) * 255)
    depthBuffer[pixelIndex] = depth
  }
}

function edgeFunction(a: [number, number], b: [number, number], p: [number, number]): number {
  return (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
}

function triangleNormal(a: Pdf3DVector3, b: Pdf3DVector3, c: Pdf3DVector3, name: string): Pdf3DVector3 {
  return unitVector3(crossVector3(subtractVector3(b, a), subtractVector3(c, a)), `PDF 3D primitive ${JSON.stringify(name)} face normal`)
}

function pointInsideClippingPlanes(point: Pdf3DVector3, planes: Pdf3DClippingPlane[]): boolean {
  for (let index = 0; index < planes.length; index++) {
    const plane = planes[index]!
    if (dotVector3(subtractVector3(point, plane.point), plane.normal) < 0) return false
  }
  return true
}

function clipPosterSegment(a: Pdf3DVector3, b: Pdf3DVector3, planes: Pdf3DClippingPlane[]): [Pdf3DVector3, Pdf3DVector3] | null {
  let start = a, end = b
  for (let index = 0; index < planes.length; index++) {
    const plane = planes[index]!
    const startDistance = dotVector3(subtractVector3(start, plane.point), plane.normal)
    const endDistance = dotVector3(subtractVector3(end, plane.point), plane.normal)
    if (startDistance < 0 && endDistance < 0) return null
    if (startDistance >= 0 && endDistance >= 0) continue
    const amount = startDistance / (startDistance - endDistance)
    const intersection: Pdf3DVector3 = [
      start[0] + (end[0] - start[0]) * amount,
      start[1] + (end[1] - start[1]) * amount,
      start[2] + (end[2] - start[2]) * amount,
    ]
    if (startDistance < 0) start = intersection
    else end = intersection
  }
  return [start, end]
}

function perspectiveBarycentric(barycentric: [number, number, number], weights: [number, number, number]): [number, number, number] {
  const a = barycentric[0] * weights[0], b = barycentric[1] * weights[1], c = barycentric[2] * weights[2]
  const total = a + b + c
  if (Math.abs(total) <= Number.EPSILON) return barycentric
  return [a / total, b / total, c / total]
}

function interpolateColor(colors: [[number, number, number, number], [number, number, number, number], [number, number, number, number]], weights: [number, number, number]): [number, number, number, number] {
  return [
    colors[0][0] * weights[0] + colors[1][0] * weights[1] + colors[2][0] * weights[2],
    colors[0][1] * weights[0] + colors[1][1] * weights[1] + colors[2][1] * weights[2],
    colors[0][2] * weights[0] + colors[1][2] * weights[1] + colors[2][2] * weights[2],
    colors[0][3] * weights[0] + colors[1][3] * weights[1] + colors[2][3] * weights[2],
  ]
}

function textureCoordinatesForFragment(triangle: RasterTriangle, layer: Pdf3DTextureLayer, weights: [number, number, number]): [number, number] {
  const coordinates = triangle.primitive.faceTextureCoordinates?.[triangle.face]?.[layer.channel]
  let point: [number, number, number, number]
  if (layer.textureMode === 0 && coordinates !== undefined) point = [
    coordinates[0][0] * weights[0] + coordinates[1][0] * weights[1] + coordinates[2][0] * weights[2],
    coordinates[0][1] * weights[0] + coordinates[1][1] * weights[1] + coordinates[2][1] * weights[2],
    coordinates[0][2] * weights[0] + coordinates[1][2] * weights[1] + coordinates[2][2] * weights[2],
    coordinates[0][3] * weights[0] + coordinates[1][3] * weights[1] + coordinates[2][3] * weights[2],
  ]
  else {
    const world: Pdf3DVector3 = [
      triangle.points[0][0] * weights[0] + triangle.points[1][0] * weights[1] + triangle.points[2][0] * weights[2],
      triangle.points[0][1] * weights[0] + triangle.points[1][1] * weights[1] + triangle.points[2][1] * weights[2],
      triangle.points[0][2] * weights[0] + triangle.points[1][2] * weights[1] + triangle.points[2][2] * weights[2],
    ]
    const wrapped = transformPoint(invertMatrix(layer.wrapTransform), world)
    if (layer.textureMode === 2) point = [Math.atan2(wrapped[1], wrapped[0]) / (2 * Math.PI) + 0.5, wrapped[2], 0, 1]
    else if (layer.textureMode === 3 || layer.textureMode === 4) {
      const radius = Math.max(Number.EPSILON, Math.sqrt(dotVector3(wrapped, wrapped)))
      point = [Math.atan2(wrapped[1], wrapped[0]) / (2 * Math.PI) + 0.5, Math.acos(Math.max(-1, Math.min(1, wrapped[2] / radius))) / Math.PI, 0, 1]
    } else point = [wrapped[0], wrapped[1], wrapped[2], 1]
  }
  const transformed = transformPoint(layer.textureTransform, [point[0], point[1], point[2]])
  return [transformed[0], transformed[1]]
}

function sampleTexture(layer: Pdf3DTextureLayer, coordinate: [number, number]): [number, number, number, number] | null {
  let u = coordinate[0], v = coordinate[1]
  if (layer.wrapModes !== undefined) {
    u = wrappedPrcTextureCoordinate(u, layer.wrapModes[0])
    v = wrappedPrcTextureCoordinate(v, layer.wrapModes[1])
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null
  } else {
    u = (layer.repeat & 1) !== 0 ? u - Math.floor(u) : clampUnit(u)
    v = (layer.repeat & 2) !== 0 ? v - Math.floor(v) : clampUnit(v)
  }
  const image = layer.image
  const x = u * Math.max(0, image.width - 1), y = (1 - v) * Math.max(0, image.height - 1)
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1)
  const tx = x - x0, ty = y - y0
  const result: [number, number, number, number] = [0, 0, 0, 0]
  for (let channel = 0; channel < 4; channel++) {
    const a = image.rgba[(y0 * image.width + x0) * 4 + channel]!
    const b = image.rgba[(y0 * image.width + x1) * 4 + channel]!
    const c = image.rgba[(y1 * image.width + x0) * 4 + channel]!
    const d = image.rgba[(y1 * image.width + x1) * 4 + channel]!
    result[channel] = ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) / 255
  }
  return result
}

function wrappedPrcTextureCoordinate(value: number, mode: number): number {
  if (mode === 2) return value - Math.floor(value)
  if (mode === 3 && (value < 0 || value > 1)) return Number.NaN
  if (mode === 6) {
    const period = value - Math.floor(value / 2) * 2
    return period <= 1 ? period : 2 - period
  }
  if (mode === 1 || mode === 3 || mode === 4 || mode === 5) return clampUnit(value)
  throw new Error(`PRC texture has invalid wrapping mode ${mode}`)
}

function blendTextureLayer(previous: [number, number, number, number], sampled: [number, number, number, number], layer: Pdf3DTextureLayer): [number, number, number, number] {
  const current: [number, number, number, number] = [sampled[0] * layer.intensity, sampled[1] * layer.intensity, sampled[2] * layer.intensity, sampled[3]]
  let result: [number, number, number, number]
  if (layer.prcTextureFunction === 4) {
    const blend = layer.blendColor ?? [1, 1, 1, 1]
    result = [
      previous[0] * (1 - current[0]) + blend[0] * current[0],
      previous[1] * (1 - current[1]) + blend[1] * current[1],
      previous[2] * (1 - current[2]) + blend[2] * current[2],
      previous[3] * current[3],
    ]
  } else if (layer.prcTextureFunction === 5) {
    result = [
      current[0] * current[3] + previous[0] * (1 - current[3]),
      current[1] * current[3] + previous[1] * (1 - current[3]),
      current[2] * current[3] + previous[2] * (1 - current[3]),
      previous[3],
    ]
  } else if (layer.blendFunction === 0) result = [previous[0] * current[0], previous[1] * current[1], previous[2] * current[2], previous[3] * current[3]]
  else if (layer.blendFunction === 1) result = [previous[0] + current[0], previous[1] + current[1], previous[2] + current[2], Math.max(previous[3], current[3])]
  else if (layer.blendFunction === 2) result = current
  else {
    const factor = layer.blendSource === 0 ? current[3] : clampUnit(layer.blendConstant)
    result = [current[0] * factor + previous[0] * (1 - factor), current[1] * factor + previous[1] * (1 - factor), current[2] * factor + previous[2] * (1 - factor), current[3] * factor + previous[3] * (1 - factor)]
  }
  const mask = layer.componentMask ?? 0x0F
  return [
    (mask & 1) === 0 ? previous[0] : result[0],
    (mask & 2) === 0 ? previous[1] : result[1],
    (mask & 4) === 0 ? previous[2] : result[2],
    (mask & 8) === 0 ? previous[3] : result[3],
  ]
}

function u3dAlphaTest(alpha: number, reference: number, compare: number): boolean {
  if (compare === 0x0610) return false
  if (compare === 0x0611) return alpha < reference
  if (compare === 0x0612) return alpha > reference
  if (compare === 0x0613) return alpha === reference
  if (compare === 0x0614) return alpha !== reference
  if (compare === 0x0615) return alpha <= reference
  if (compare === 0x0616) return alpha >= reference
  return true
}

function shadePosterVertex(
  scene: Pdf3DDecodedScene,
  point: Pdf3DVector3,
  normal: Pdf3DVector3 | undefined,
  surface: Pdf3DSurfaceMaterial | undefined,
  fallback: [number, number, number, number],
): [number, number, number, number] {
  if (surface === undefined || !surface.lighting || normal === undefined) return fallback
  const lights = scene.lights ?? []
  if (lights.length === 0) return fallback
  const result: Pdf3DVector3 = [...surface.emissive]
  const nodeMap = new Map<string, Pdf3DSceneNode>()
  for (let index = 0; index < scene.nodes.length; index++) nodeMap.set(scene.nodes[index]!.name, scene.nodes[index]!)
  const view = scene.nodes.find(function (node): node is Pdf3DViewNode { return node.kind === 'view' })
  const viewMatrix = view === undefined ? undefined : nodeWorldMatrices(view, nodeMap, new Set<string>())[0]
  const viewPosition: Pdf3DVector3 | undefined = viewMatrix === undefined ? undefined : [viewMatrix[12], viewMatrix[13], viewMatrix[14]]
  const unitNormal = unitVector3(normal, 'PDF 3D lighting normal')
  for (let index = 0; index < lights.length; index++) {
    const light = lights[index]!
    if (!light.enabled) continue
    const node = nodeMap.get(light.nodeName)
    if (node === undefined) throw new Error(`PDF 3D light ${JSON.stringify(light.name)} has no scene node`)
    const matrices = nodeWorldMatrices(node, nodeMap, new Set<string>())
    for (let matrixIndex = 0; matrixIndex < matrices.length; matrixIndex++) {
      const matrix = matrices[matrixIndex]!
      if (light.type === 'ambient') {
        const ambientColor = light.ambientColor ?? light.color
        for (let channel = 0; channel < 3; channel++) result[channel] = result[channel]! + surface.ambient[channel]! * ambientColor[channel]!
        continue
      }
      let toLight: Pdf3DVector3
      let attenuation = light.intensity
      if (light.type === 'directional') {
        const direction = transformVector(matrix, [0, 0, -1])
        toLight = [-direction[0], -direction[1], -direction[2]]
      } else {
        const position = transformPoint(matrix, [0, 0, 0])
        const delta = subtractVector3(position, point)
        const distance = Math.sqrt(dotVector3(delta, delta))
        if (distance <= Number.EPSILON) continue
        toLight = [delta[0] / distance, delta[1] / distance, delta[2] / distance]
        const divisor = light.attenuation[0] + light.attenuation[1] * distance + light.attenuation[2] * distance * distance
        if (divisor <= Number.EPSILON) continue
        attenuation /= divisor
        if (light.type === 'spot') {
          const direction = transformVector(matrix, [0, 0, -1])
          const fromLight: Pdf3DVector3 = [-toLight[0], -toLight[1], -toLight[2]]
          const cosine = dotVector3(direction, fromLight)
          const cutoff = Math.cos(light.spotAngle * Math.PI / 360)
          if (cosine < cutoff) continue
          if ((light.spotAngle < 180) && cosine > 0) attenuation *= Math.pow(cosine, light.spotExponent ?? 1)
        }
      }
      const diffuse = Math.max(0, dotVector3(unitNormal, toLight)) * attenuation
      const diffuseColor = light.diffuseColor ?? light.color
      const emissiveColor = light.emissiveColor ?? [0, 0, 0]
      for (let channel = 0; channel < 3; channel++) {
        result[channel] = result[channel]! + emissiveColor[channel]! * attenuation
        result[channel] = result[channel]! + surface.diffuse[channel]! * diffuseColor[channel]! * diffuse
      }
      if (light.specular && surface.reflectivity > 0 && viewPosition !== undefined && diffuse > 0) {
        const toView = unitVector3(subtractVector3(viewPosition, point), 'PDF 3D lighting view vector')
        const halfVector = unitVector3([toLight[0] + toView[0], toLight[1] + toView[1], toLight[2] + toView[2]], 'PDF 3D lighting half vector')
        const exponent = clampUnit(surface.reflectivity) * 128
        const specular = Math.pow(Math.max(0, dotVector3(unitNormal, halfVector)), exponent) * attenuation
        const specularColor = light.specularColor ?? light.color
        for (let channel = 0; channel < 3; channel++) result[channel] = result[channel]! + surface.specular[channel]! * specularColor[channel]! * specular
      }
    }
  }
  return [result[0], result[1], result[2], surface.opacity]
}

function appendPosterLine(ops: string[], a: [number, number], b: [number, number], scale: number, offsetX: number, offsetY: number): void {
  ops.push(`${pdfNumber(a[0] * scale + offsetX)} ${pdfNumber(a[1] * scale + offsetY)} m ${pdfNumber(b[0] * scale + offsetX)} ${pdfNumber(b[1] * scale + offsetY)} l S`)
}

function posterCoordinate(point: Pdf3DVector3, scale: number, offsetX: number, offsetY: number, projection: Pdf3DPosterProjection): [number, number] {
  const projected = projection.point(point)
  return [projected[0] * scale + offsetX, projected[1] * scale + offsetY]
}

function clampUnit(value: number): number { return Math.max(0, Math.min(1, value)) }
function posterOpaqueColor(color: [number, number, number, number]): [number, number, number] {
  const alpha = clampUnit(color[3])
  return [clampUnit(color[0]) * alpha + 0.97 * (1 - alpha), clampUnit(color[1]) * alpha + 0.97 * (1 - alpha), clampUnit(color[2]) * alpha + 0.97 * (1 - alpha)]
}

function readU3dBlocks(bytes: Uint8Array, start: number, end: number, label: string): U3dBlock[] {
  const reader = new U3dReader(bytes.subarray(start, end), label)
  const blocks: U3dBlock[] = []
  while (reader.remaining > 0) {
    if (reader.remaining < 12) throw new Error(`${label}: truncated block header at byte ${start + reader.offset}`)
    const blockStart = reader.offset
    const type = reader.u32()
    const dataSize = reader.u32()
    const metadataSize = reader.u32()
    const blockData = reader.take(dataSize)
    reader.align4()
    const metadataBytes = reader.take(metadataSize)
    reader.align4()
    blocks.push({
      type,
      data: blockData,
      metadata: readMetadata(metadataBytes, `${label} block 0x${type.toString(16)} metadata`),
      offset: start + blockStart,
      byteLength: reader.offset - blockStart,
    })
  }
  return blocks
}

function readMetadata(bytes: Uint8Array, label: string): U3dMetadataEntry[] {
  if (bytes.length === 0) return []
  const reader = new U3dReader(bytes, label)
  const count = reader.u32()
  const entries = new Array<U3dMetadataEntry>(count)
  for (let index = 0; index < count; index++) {
    const attributes = reader.u32()
    if ((attributes & ~0x00000773) !== 0) throw new Error(`${label}: reserved Key/Value Pair Attributes are set`)
    const key = reader.string()
    const value = (attributes & 1) === 0 ? reader.string() : reader.take(reader.u32()).slice()
    entries[index] = { attributes, key, value }
  }
  reader.finish()
  return entries
}

function readU3dHeader(block: U3dBlock, actualSize: number): U3dHeader {
  const reader = new U3dReader(block.data, 'U3D File Header')
  const majorVersion = reader.i16()
  const minorVersion = reader.i16()
  if (majorVersion > 0) throw new Error(`U3D decode error: unsupported major version ${majorVersion}`)
  const profile = reader.u32()
  if ((profile & ~0x0E) !== 0) throw new Error('U3D decode error: reserved profile bits are set')
  const declarationSize = reader.u32()
  const fileSize = reader.u64()
  if (fileSize !== actualSize) throw new Error(`U3D decode error: File Size ${fileSize} does not match ${actualSize} bytes`)
  const characterEncoding = reader.u32()
  if (characterEncoding !== 106) throw new Error('U3D decode error: current-version files must use UTF-8 (MIB 106)')
  const unitsInMeters = (profile & 8) === 0 ? null : reader.f64()
  if (unitsInMeters !== null && unitsInMeters <= 0) throw new Error('U3D decode error: Units Scaling Factor must be positive')
  reader.finish()
  return { majorVersion, minorVersion, profile, declarationSize, fileSize, characterEncoding: 106, unitsInMeters }
}

function readModifierChain(block: U3dBlock, header: U3dHeader): U3dModifierChain {
  const reader = new U3dReader(block.data, `U3D Modifier Chain at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  const chainType = reader.u32()
  if (chainType !== 0 && chainType !== 1 && chainType !== 2) throw new Error(`${reader.label}: invalid Modifier Chain Type`)
  const attributes = reader.u32()
  if ((attributes & ~3) !== 0) throw new Error(`${reader.label}: reserved Modifier Chain Attributes are set`)
  const boundingSphere = (attributes & 1) === 0 ? undefined : readBoundingSphere(reader)
  const boundingBox = (attributes & 2) === 0 ? undefined : readBoundingBox(reader)
  reader.align4()
  const count = reader.u32()
  const nestedStart = reader.offset
  const modifierBlocks = readU3dBlocks(block.data, nestedStart, block.data.length, reader.label)
  if (modifierBlocks.length !== count) throw new Error(`${reader.label}: Modifier Count ${count} does not match ${modifierBlocks.length} blocks`)
  if (block.offset + block.byteLength > header.declarationSize) throw new Error(`${reader.label}: declaration crosses the Declaration Size boundary`)
  for (let index = 0; index < modifierBlocks.length; index++) {
    const nested = modifierBlocks[index]!
    nested.offset += block.offset + 12
    const nestedReader = new U3dReader(nested.data, `${reader.label} nested block`)
    const nestedName = nestedReader.string()
    if (nestedName !== name) throw new Error(`${reader.label}: modifier block name does not match its chain name`)
  }
  return { name, chainType, boundingSphere, boundingBox, modifierBlocks }
}

function readMeshDeclaration(block: U3dBlock): U3dMeshDeclaration {
  const reader = new U3dReader(block.data, `U3D CLOD Mesh Declaration at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  if (reader.u32() !== 0) throw new Error(`${reader.label}: Chain Index must be zero`)
  const meshAttributes = reader.u32()
  if ((meshAttributes & ~1) !== 0) throw new Error(`${reader.label}: reserved Mesh Attributes are set`)
  const faceCount = reader.u32()
  const positionCount = reader.u32()
  const normalCount = reader.u32()
  const diffuseColorCount = reader.u32()
  const specularColorCount = reader.u32()
  const textureCoordinateCount = reader.u32()
  const shadingCount = reader.u32()
  const shadings = new Array<U3dShadingDescription>(shadingCount)
  for (let index = 0; index < shadingCount; index++) {
    const attributes = reader.u32()
    if ((attributes & ~3) !== 0) throw new Error(`${reader.label}: reserved Shading Attributes are set`)
    const textureLayerCount = reader.u32()
    const textureDimensions = new Array<number>(textureLayerCount)
    for (let layer = 0; layer < textureLayerCount; layer++) {
      const dimensions = reader.u32()
      if (dimensions < 1 || dimensions > 4) throw new Error(`${reader.label}: Texture Coord Dimensions must be 1 through 4`)
      textureDimensions[layer] = dimensions
    }
    reader.u32()
    shadings[index] = { attributes, textureDimensions }
  }
  const minimumResolution = reader.u32()
  const finalMaximumResolution = reader.u32()
  if (minimumResolution > finalMaximumResolution || finalMaximumResolution !== positionCount) {
    throw new Error(`${reader.label}: CLOD resolution range does not match Position Count`)
  }
  reader.u32(); reader.u32(); reader.u32()
  const positionInverseQuant = positiveQuant(reader.f32(), reader.label, 'Position')
  const normalInverseQuant = positiveQuant(reader.f32(), reader.label, 'Normal')
  const textureInverseQuant = positiveQuant(reader.f32(), reader.label, 'Texture Coord')
  const diffuseInverseQuant = positiveQuant(reader.f32(), reader.label, 'Diffuse Color')
  const specularInverseQuant = positiveQuant(reader.f32(), reader.label, 'Specular Color')
  reader.f32(); reader.f32(); reader.f32()
  readSkeletonDescription(reader)
  reader.finish()
  return {
    name, meshAttributes, faceCount, positionCount, normalCount, diffuseColorCount,
    specularColorCount, textureCoordinateCount, shadings, minimumResolution,
    finalMaximumResolution, positionInverseQuant, normalInverseQuant, textureInverseQuant,
    diffuseInverseQuant, specularInverseQuant,
  }
}

function readPointLineDeclaration(block: U3dBlock): U3dPointLineResource {
  const kind = block.type === U3D_POINT_SET_DECLARATION ? 'points' : 'lines'
  const reader = new U3dReader(block.data, `U3D ${kind === 'points' ? 'Point' : 'Line'} Set Declaration at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  if (reader.u32() !== 0) throw new Error(`${reader.label}: Chain Index must be zero`)
  if (reader.u32() !== 0) throw new Error(`${reader.label}: reserved geometry field must be zero`)
  const elementCount = reader.u32()
  const positionCount = reader.u32()
  const normalCount = reader.u32()
  const diffuseColorCount = reader.u32()
  const specularColorCount = reader.u32()
  const textureCoordinateCount = reader.u32()
  const shadingCount = reader.u32()
  const shadings = new Array<U3dShadingDescription>(shadingCount)
  for (let index = 0; index < shadingCount; index++) {
    const attributes = reader.u32()
    if ((attributes & ~3) !== 0) throw new Error(`${reader.label}: reserved Shading Attributes are set`)
    const layerCount = reader.u32()
    const textureDimensions = new Array<number>(layerCount)
    for (let layer = 0; layer < layerCount; layer++) {
      const dimensions = reader.u32()
      if (dimensions < 1 || dimensions > 4) throw new Error(`${reader.label}: Texture Coord Dimensions must be 1 through 4`)
      textureDimensions[layer] = dimensions
    }
    reader.u32()
    shadings[index] = { attributes, textureDimensions }
  }
  reader.u32(); reader.u32(); reader.u32()
  const positionInverseQuant = positiveQuant(reader.f32(), reader.label, 'Position')
  const normalInverseQuant = positiveQuant(reader.f32(), reader.label, 'Normal')
  const textureInverseQuant = positiveQuant(reader.f32(), reader.label, 'Texture Coord')
  const diffuseInverseQuant = positiveQuant(reader.f32(), reader.label, 'Diffuse Color')
  const specularInverseQuant = positiveQuant(reader.f32(), reader.label, 'Specular Color')
  if (reader.u32() !== 0 || reader.u32() !== 0 || reader.u32() !== 0) throw new Error(`${reader.label}: reserved resource parameter must be zero`)
  readSkeletonDescription(reader)
  reader.finish()
  return {
    kind, name, elementCount, positionCount, normalCount, diffuseColorCount,
    specularColorCount, textureCoordinateCount, shadings, positionInverseQuant,
    normalInverseQuant, textureInverseQuant, diffuseInverseQuant, specularInverseQuant,
    positions: [], elementPositionIndices: [], diffuseColors: [], specularColors: [], textureCoordinates: [], elementShadings: [], elementDiffuseIndices: [],
  }
}

function readPointLineContinuation(block: U3dBlock, resources: Map<string, U3dPointLineResource>): void {
  const reader = new U3dBitReader(block.data, `U3D geometry continuation at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  const resource = resources.get(name)
  if (resource === undefined) throw new Error(`${reader.label}: no declaration exists for ${JSON.stringify(name)}`)
  const expectedType = resource.kind === 'points' ? U3D_POINT_SET_CONTINUATION : U3D_LINE_SET_CONTINUATION
  if (block.type !== expectedType) throw new Error(`${reader.label}: continuation type does not match its declaration`)
  if (reader.u32() !== 0) throw new Error(`${reader.label}: Chain Index must be zero`)
  const start = reader.u32()
  const end = reader.u32()
  if (start !== resource.positions.length || end < start || end > resource.positionCount) throw new Error(`${reader.label}: invalid resolution range`)
  for (let resolution = start; resolution < end; resolution++) {
    const splitIndex = reader.compressedU32(resource.positions.length === 0 ? 1 : resource.positions.length)
    const prediction: Pdf3DVector3 = resource.positions.length === 0 ? [0, 0, 0] : resource.positions[splitIndex]!
    if (prediction === undefined) throw new Error(`${reader.label}: Split Position Index is outside the current positions`)
    const signs = reader.compressedU8('cPosDiffSign')
    const position: Pdf3DVector3 = [
      inverseQuant(prediction[0], signs & 1, reader.compressedU32('cPosDiffX'), resource.positionInverseQuant),
      inverseQuant(prediction[1], (signs >>> 1) & 1, reader.compressedU32('cPosDiffY'), resource.positionInverseQuant),
      inverseQuant(prediction[2], (signs >>> 2) & 1, reader.compressedU32('cPosDiffZ'), resource.positionInverseQuant),
    ]
    resource.positions.push(position)
    const normalCount = reader.compressedU32('cNormlCnt')
    for (let normal = 0; normal < normalCount; normal++) {
      reader.compressedU8('cDiffNormalSign')
      reader.compressedU32('cDiffNormalX'); reader.compressedU32('cDiffNormalY'); reader.compressedU32('cDiffNormalZ')
    }
    const newElementCount = reader.compressedU32(resource.kind === 'points' ? 'cPointCnt' : 'cLineCnt')
    for (let element = 0; element < newElementCount; element++) {
      const shadingIndex = reader.compressedU32('cBaseShading')
      const shading = resource.shadings[shadingIndex]
      if (shading === undefined) throw new Error(`${reader.label}: Shading ID is outside the declaration`)
      const diffusePrediction = pointLinePredictedColor(resource, splitIndex)
      resource.elementShadings.push(shadingIndex)
      if (resource.kind === 'lines') {
        const first = readStaticIndex(reader, resolution, 'First Position')
        resource.elementPositionIndices.push(first, resolution)
      } else resource.elementPositionIndices.push(resolution)
      reader.compressedU32('cNormlIdx')
      readPointLineVertexAttributes(reader, resource, shading, diffusePrediction)
      if (resource.kind === 'lines') readPointLineVertexAttributes(reader, resource, shading, diffusePrediction)
    }
  }
  if (resource.diffuseColors.length > resource.diffuseColorCount || resource.specularColors.length > resource.specularColorCount || resource.textureCoordinates.length > resource.textureCoordinateCount) {
    throw new Error(`${reader.label}: decoded vertex attributes exceed their declared pool sizes`)
  }
}

function readPointLineVertexAttributes(reader: U3dBitReader, resource: U3dPointLineResource, shading: U3dShadingDescription, diffusePrediction: [number, number, number, number]): void {
  if ((shading.attributes & 1) !== 0) {
    resource.elementDiffuseIndices.push(readPointLineQuantizedAttribute(reader, 'cColorDup', 'cDiffNormalSign', 'cColorDiff', resource.diffuseInverseQuant, diffusePrediction, resource.diffuseColors))
  }
  if ((shading.attributes & 2) !== 0) {
    readPointLineQuantizedAttribute(reader, 'cColorDup', 'cDiffNormalSign', 'cColorDiff', resource.specularInverseQuant, [0, 0, 0, 0], resource.specularColors)
  }
  for (let layer = 0; layer < shading.textureDimensions.length; layer++) {
    readPointLineQuantizedAttribute(reader, 'cTexCDup', 'cTexCoordSign', 'cTexCDiff', resource.textureInverseQuant, [0, 0, 0, 0], resource.textureCoordinates)
  }
}

function readPointLineQuantizedAttribute(
  reader: U3dBitReader,
  duplicateContext: string,
  signContext: string,
  valueContext: string,
  inverse: number,
  prediction: [number, number, number, number],
  pool: Array<[number, number, number, number]>,
): number {
  const duplicate = reader.compressedU8(duplicateContext)
  if ((duplicate & ~2) !== 0) throw new Error(`${reader.label}: reserved duplicate flag is set`)
  if ((duplicate & 2) !== 0) {
    if (pool.length === 0) throw new Error(`${reader.label}: duplicate vertex attribute has no preceding value`)
    return pool.length - 1
  }
  const signs = reader.compressedU8(signContext)
  const value = new Array<number>(4)
  for (let component = 0; component < 4; component++) value[component] = inverseQuant(prediction[component]!, (signs >>> component) & 1, reader.compressedU32(`${valueContext}${component}`), inverse)
  pool.push(value as [number, number, number, number])
  return pool.length - 1
}

function pointLinePredictedColor(resource: U3dPointLineResource, splitPosition: number): [number, number, number, number] {
  const pool = resource.diffuseColors
  const indices = resource.elementDiffuseIndices
  if (indices.length === 0) return [0, 0, 0, 0]
  const sum: [number, number, number, number] = [0, 0, 0, 0]
  let count = 0
  for (let index = 0; index < resource.elementPositionIndices.length && index < indices.length; index++) {
    if (resource.elementPositionIndices[index] !== splitPosition) continue
    const color = pool[indices[index]!]
    if (color === undefined) continue
    for (let component = 0; component < 4; component++) sum[component] = sum[component]! + color[component]!
    count++
  }
  if (count === 0) return sum
  for (let component = 0; component < 4; component++) sum[component] = sum[component]! / count
  return sum
}

function inverseQuant(prediction: number, sign: number, difference: number, inverse: number): number {
  return prediction + (sign === 0 ? difference : -difference) * inverse
}

function readBaseMeshContinuation(
  block: U3dBlock,
  declarations: Map<string, U3dMeshDeclaration>,
): U3dMeshState {
  const reader = new U3dBitReader(block.data, `U3D CLOD Base Mesh Continuation at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  const declaration = declarations.get(name)
  if (declaration === undefined) throw new Error(`${reader.label}: no CLOD Mesh Declaration exists for ${JSON.stringify(name)}`)
  if (reader.u32() !== 0) throw new Error(`${reader.label}: Chain Index must be zero`)
  const faceCount = reader.u32()
  const positionCount = reader.u32()
  const normalCount = reader.u32()
  const diffuseCount = reader.u32()
  const specularCount = reader.u32()
  const textureCount = reader.u32()
  if (positionCount !== declaration.minimumResolution || faceCount > declaration.faceCount
    || normalCount > declaration.normalCount || diffuseCount > declaration.diffuseColorCount
    || specularCount > declaration.specularColorCount || textureCount > declaration.textureCoordinateCount) {
    throw new Error(`${reader.label}: Base Mesh Description exceeds its declaration`)
  }
  const positions = readVectors3(reader, positionCount)
  const normals = readVectors3(reader, normalCount)
  const diffuseColors = readColors(reader, diffuseCount)
  const specularColors = readColors(reader, specularCount)
  const textureCoordinates = readVectors4(reader, textureCount)

  const faces = new Array<U3dMeshFace>(faceCount)
  for (let face = 0; face < faceCount; face++) {
    const shadingIndex = reader.compressedU32('cBaseShading')
    const shading = declaration.shadings[shadingIndex]
    if (shading === undefined) throw new Error(`${reader.label}: Shading ID is outside the declaration`)
    const item: U3dMeshFace = { shading: shadingIndex, positions: [0, 0, 0], normals: [0, 0, 0], textures: [] }
    if ((shading.attributes & 1) !== 0) item.diffuse = [0, 0, 0]
    if ((shading.attributes & 2) !== 0) item.specular = [0, 0, 0]
    for (let layer = 0; layer < shading.textureDimensions.length; layer++) item.textures[layer] = [0, 0, 0]
    for (let corner = 0; corner < 3; corner++) {
      item.positions[corner] = readStaticIndex(reader, positionCount, 'Base Position')
      if ((declaration.meshAttributes & 1) === 0) item.normals[corner] = readStaticIndex(reader, normalCount, 'Base Normal')
      if (item.diffuse !== undefined) item.diffuse[corner] = readStaticIndex(reader, diffuseCount, 'Base Diffuse Color')
      if (item.specular !== undefined) item.specular[corner] = readStaticIndex(reader, specularCount, 'Base Specular Color')
      for (let layer = 0; layer < item.textures.length; layer++) item.textures[layer]![corner] = readStaticIndex(reader, textureCount, 'Base Texture Coord')
    }
    faces[face] = item
  }
  return { declaration, positions, normals, diffuseColors, specularColors, textureCoordinates, faces }
}

function meshStatePrimitive(
  state: U3dMeshState,
  modifier: U3dShadingModifier | undefined,
  shaders: Map<string, U3dLitTextureShader>,
  materials: Map<string, U3dMaterialResource>,
  textures: Map<string, Pdf3DTextureImage>,
): Pdf3DTrianglePrimitive {
  const positions: Pdf3DVector3[] = []
  const colors: Array<[number, number, number, number]> = []
  const normals: Pdf3DVector3[] = []
  const surfaces: Pdf3DSurfaceMaterial[] = []
  const faceRenderPasses: Pdf3DRenderPass[][] = []
  const faceTextureCoordinates: Array<Array<[
    [number, number, number, number], [number, number, number, number], [number, number, number, number],
  ]>> = []
  const indices = new Array<number>(state.faces.length * 3)
  for (let faceIndex = 0; faceIndex < state.faces.length; faceIndex++) {
    const face = state.faces[faceIndex]!
    const facePositions = face.positions.map(function (index) { return state.positions[index]! }) as [Pdf3DVector3, Pdf3DVector3, Pdf3DVector3]
    const edgeA = subtractVector3(facePositions[1], facePositions[0])
    const edgeB = subtractVector3(facePositions[2], facePositions[0])
    const geometricNormal = unitVector3(crossVector3(edgeA, edgeB), `U3D mesh ${JSON.stringify(state.declaration.name)} face normal`)
    const faceVertexColors: Array<[number, number, number, number] | undefined> = []
    for (let corner = 0; corner < 3; corner++) {
      const position = facePositions[corner]
      if (position === undefined) throw new Error(`U3D mesh ${JSON.stringify(state.declaration.name)} has an invalid position index`)
      positions.push([...position] as Pdf3DVector3)
      const normal = (state.declaration.meshAttributes & 1) === 0 ? state.normals[face.normals[corner]!] : geometricNormal
      if (normal === undefined) throw new Error(`U3D mesh ${JSON.stringify(state.declaration.name)} has an invalid normal index`)
      normals.push(unitVector3(normal, `U3D mesh ${JSON.stringify(state.declaration.name)} vertex normal`))
      const colorIndex = face.diffuse?.[corner]
      const vertexColor = colorIndex === undefined ? undefined : state.diffuseColors[colorIndex]
      faceVertexColors.push(vertexColor)
      if (colorIndex !== undefined && vertexColor === undefined) throw new Error(`U3D mesh ${JSON.stringify(state.declaration.name)} has an invalid diffuse-color index`)
      colors.push(resolveU3dFaceColor(face.shading, vertexColor, modifier, shaders, materials))
      surfaces.push(resolveU3dSurface(face.shading, vertexColor, modifier, shaders, materials))
      indices[faceIndex * 3 + corner] = faceIndex * 3 + corner
    }
    const passes = resolveU3dRenderPasses(face.shading, faceVertexColors[0], modifier, shaders, materials, textures)
    faceRenderPasses.push(passes)
    const coordinates: Array<[
      [number, number, number, number], [number, number, number, number], [number, number, number, number],
    ]> = []
    for (let layer = 0; layer < face.textures.length; layer++) {
      const indicesForLayer = face.textures[layer]!
      const a = state.textureCoordinates[indicesForLayer[0]], b = state.textureCoordinates[indicesForLayer[1]], c = state.textureCoordinates[indicesForLayer[2]]
      if (a === undefined || b === undefined || c === undefined) throw new Error(`U3D mesh ${JSON.stringify(state.declaration.name)} has an invalid texture-coordinate index`)
      coordinates[layer] = [a, b, c]
    }
    faceTextureCoordinates.push(coordinates)
  }
  const hasLighting = surfaces.some(function (surface) { return surface.lighting })
  const hasTextures = faceRenderPasses.some(function (passes) { return passes.some(function (pass) { return pass.layers.length > 0 }) })
  return {
    kind: 'triangles', name: state.declaration.name, positions, indices, colors,
    ...(hasLighting ? { normals, surfaces } : {}),
    ...(hasTextures ? { faceRenderPasses, faceTextureCoordinates } : {}),
  }
}

function resolveU3dRenderPasses(
  shadingIndex: number,
  vertexColor: [number, number, number, number] | undefined,
  modifier: U3dShadingModifier | undefined,
  shaders: Map<string, U3dLitTextureShader>,
  materials: Map<string, U3dMaterialResource>,
  textures: Map<string, Pdf3DTextureImage>,
): Pdf3DRenderPass[] {
  if (modifier === undefined || (modifier.attributes & 1) === 0) return []
  const names = modifier.shaderLists[shadingIndex]
  if (names === undefined) throw new Error(`U3D decode error: shading index ${shadingIndex} is outside the modifier shader lists`)
  const result: Pdf3DRenderPass[] = []
  for (let index = 0; index < names.length; index++) {
    const shader = shaders.get(names[index]!)
    if (shader === undefined) throw new Error(`U3D decode error: shading modifier references missing shader ${JSON.stringify(names[index])}`)
    const layers = shader.layers.map(function (layer): Pdf3DTextureLayer {
      const image = textures.get(layer.textureName)
      if (image === undefined) throw new Error(`U3D decode error: shader ${JSON.stringify(shader.name)} references missing texture ${JSON.stringify(layer.textureName)}`)
      return { ...layer, image }
    })
    const material = materials.get(shader.materialName)
    if (material === undefined) throw new Error(`U3D decode error: shader ${JSON.stringify(shader.name)} references missing material ${JSON.stringify(shader.materialName)}`)
    result.push({
      material: u3dSurfaceFromShader(shader, material, vertexColor),
      alphaReference: shader.alphaReference, alphaCompare: shader.alphaCompare,
      frameBufferBlend: shader.frameBufferBlend, alphaTextureChannels: shader.alphaTextureChannels, layers,
    })
  }
  return result
}

function resolveU3dSurface(
  shadingIndex: number,
  vertexColor: [number, number, number, number] | undefined,
  modifier: U3dShadingModifier | undefined,
  shaders: Map<string, U3dLitTextureShader>,
  materials: Map<string, U3dMaterialResource>,
): Pdf3DSurfaceMaterial {
  const fallbackDiffuse: Pdf3DVector3 = vertexColor === undefined ? [0.32, 0.52, 0.76] : [vertexColor[0], vertexColor[1], vertexColor[2]]
  const fallback: Pdf3DSurfaceMaterial = {
    lighting: false, ambient: [0, 0, 0], diffuse: fallbackDiffuse,
    specular: [0, 0, 0], emissive: [0, 0, 0], reflectivity: 0, opacity: vertexColor?.[3] ?? 1,
  }
  if (modifier === undefined || (modifier.attributes & 1) === 0) return fallback
  const shaderNames = modifier.shaderLists[shadingIndex]
  if (shaderNames === undefined || shaderNames.length !== 1) return fallback
  const shader = shaders.get(shaderNames[0]!)
  if (shader === undefined) return fallback
  const material = materials.get(shader.materialName)
  if (material === undefined) return fallback
  return u3dSurfaceFromShader(shader, material, vertexColor)
}

function u3dSurfaceFromShader(
  shader: U3dLitTextureShader,
  material: U3dMaterialResource,
  vertexColor: [number, number, number, number] | undefined,
): Pdf3DSurfaceMaterial {
  const useVertex = (shader.attributes & 4) !== 0 && vertexColor !== undefined
  return {
    lighting: (shader.attributes & 1) !== 0,
    ambient: (material.attributes & 1) === 0 ? [0, 0, 0] : material.ambient,
    diffuse: useVertex ? [vertexColor[0], vertexColor[1], vertexColor[2]] : (material.attributes & 2) === 0 ? [0, 0, 0] : material.diffuse,
    specular: (material.attributes & 4) === 0 ? [0, 0, 0] : material.specular,
    emissive: (material.attributes & 8) === 0 ? [0, 0, 0] : material.emissive,
    reflectivity: (material.attributes & 0x10) === 0 ? 0 : material.reflectivity,
    opacity: useVertex ? vertexColor[3] : (material.attributes & 0x20) === 0 ? 1 : material.opacity,
  }
}

function resolveU3dFaceColor(
  shadingIndex: number,
  vertexColor: [number, number, number, number] | undefined,
  modifier: U3dShadingModifier | undefined,
  shaders: Map<string, U3dLitTextureShader>,
  materials: Map<string, U3dMaterialResource>,
): [number, number, number, number] {
  if (modifier === undefined || (modifier.attributes & 1) === 0) return vertexColor ?? [0.32, 0.52, 0.76, 1]
  const shaderNames = modifier.shaderLists[shadingIndex]
  if (shaderNames === undefined) throw new Error(`U3D decode error: shading index ${shadingIndex} is outside the modifier shader lists`)
  if (shaderNames.length === 0) return vertexColor ?? [0.32, 0.52, 0.76, 1]
  let result: [number, number, number, number] | null = null
  for (let index = 0; index < shaderNames.length; index++) {
    const shaderName = shaderNames[index]!
    const shader = shaders.get(shaderName)
    if (shader === undefined) throw new Error(`U3D decode error: shading modifier references missing shader ${JSON.stringify(shaderName)}`)
    const material = materials.get(shader.materialName)
    if (material === undefined) throw new Error(`U3D decode error: shader ${JSON.stringify(shaderName)} references missing material ${JSON.stringify(shader.materialName)}`)
    const usesVertexColor = (shader.attributes & 4) !== 0 && vertexColor !== undefined
    const source: [number, number, number, number] = usesVertexColor
      ? vertexColor
      : [
          (material.attributes & 2) === 0 ? 0 : material.diffuse[0],
          (material.attributes & 2) === 0 ? 0 : material.diffuse[1],
          (material.attributes & 2) === 0 ? 0 : material.diffuse[2],
          (material.attributes & 0x20) === 0 ? 1 : material.opacity,
        ]
    result = result === null ? source : compositeU3dShaderPass(result, source, shader.frameBufferBlend)
  }
  return result!
}

function compositeU3dShaderPass(
  destination: [number, number, number, number],
  source: [number, number, number, number],
  blend: number,
): [number, number, number, number] {
  if (blend === 0x0608) return source
  if (blend === 0x0609) return destination
  if (blend === 0x0604) return [destination[0] + source[0], destination[1] + source[1], destination[2] + source[2], Math.max(destination[3], source[3])]
  if (blend === 0x0605) return [destination[0] * source[0], destination[1] * source[1], destination[2] * source[2], destination[3] * source[3]]
  if (blend === 0x0606 || blend === 0x06AA) {
    const alpha = clampUnit(source[3])
    return [source[0] * alpha + destination[0] * (1 - alpha), source[1] * alpha + destination[1] * (1 - alpha), source[2] * alpha + destination[2] * (1 - alpha), alpha + destination[3] * (1 - alpha)]
  }
  if (blend === 0x0607) {
    const alpha = 1 - clampUnit(source[3])
    return [source[0] * alpha + destination[0] * (1 - alpha), source[1] * alpha + destination[1] * (1 - alpha), source[2] * alpha + destination[2] * (1 - alpha), alpha + destination[3] * (1 - alpha)]
  }
  throw new Error(`U3D decode error: invalid frame-buffer blend function 0x${blend.toString(16)}`)
}

function readProgressiveMeshContinuation(block: U3dBlock, states: Map<string, U3dMeshState>): void {
  const reader = new U3dBitReader(block.data, `U3D CLOD Progressive Mesh Continuation at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  const state = states.get(name)
  if (state === undefined) throw new Error(`${reader.label}: no base mesh exists for ${JSON.stringify(name)}; available meshes: ${JSON.stringify([...states.keys()])}`)
  if (reader.u32() !== 0) throw new Error(`${reader.label}: Chain Index must be zero`)
  const start = reader.u32()
  const end = reader.u32()
  if (start !== state.positions.length || end < start || end > state.declaration.finalMaximumResolution) {
    throw new Error(`${reader.label}: invalid resolution range`)
  }
  const previous = { diffuseSplit: 0, diffuseNew: 0, diffuseThird: 0, specularSplit: 0, specularNew: 0, specularThird: 0, textureSplit: 0, textureNew: 0, textureThird: 0 }
  for (let resolution = start; resolution < end; resolution++) readResolutionUpdate(reader, state, resolution, previous)
}

function readResolutionUpdate(
  reader: U3dBitReader,
  state: U3dMeshState,
  resolution: number,
  previous: { diffuseSplit: number; diffuseNew: number; diffuseThird: number; specularSplit: number; specularNew: number; specularThird: number; textureSplit: number; textureNew: number; textureThird: number },
): void {
  const split = reader.compressedU32(resolution === 0 ? 1 : resolution)
  if (split >= resolution && resolution !== 0) throw new Error(`${reader.label}: Split Position Index is outside the current mesh`)
  const splitFaces = facesUsingPosition(state.faces, split)
  const localPositions = positionsUsedByFaces(state.faces, splitFaces, split)
  const newDiffuseStart = state.diffuseColors.length
  readNewQuantizedVectors(reader, state.diffuseColors, reader.compressedU16('cDiffuseCount'), averageVectors(state.diffuseColors, attributeIndicesAtPosition(state.faces, split, 'diffuse')), 'cDiffuseColorSign', 'cColorDiff', state.declaration.diffuseInverseQuant)
  const newSpecularStart = state.specularColors.length
  readNewQuantizedVectors(reader, state.specularColors, reader.compressedU16('cSpecularCount'), averageVectors(state.specularColors, attributeIndicesAtPosition(state.faces, split, 'specular')), 'cSpecularColorSign', 'cColorDiff', state.declaration.specularInverseQuant)
  const newTextureStart = state.textureCoordinates.length
  readNewQuantizedVectors(reader, state.textureCoordinates, reader.compressedU16('cTexCoordCount'), averageVectors(state.textureCoordinates, textureIndicesAtPosition(state.faces, split, 0)), 'cTexCoordSign', 'cTexCDiff', state.declaration.textureInverseQuant)

  const newFaceCount = reader.compressedU32('cFaceCnt')
  const newFaceStart = state.faces.length
  const leftThird = new Set<number>()
  const rightThird = new Set<number>()
  for (let index = 0; index < newFaceCount; index++) {
    const shadingIndex = reader.compressedU32('cShading')
    const shading = state.declaration.shadings[shadingIndex]
    if (shading === undefined) throw new Error(`${reader.label}: Shading ID is outside the declaration`)
    const orientation = reader.compressedU8('cFaceOrnt')
    if (orientation !== 1 && orientation !== 2) throw new Error(`${reader.label}: invalid face orientation`)
    const thirdType = reader.compressedU8('cThrdPosType')
    let third: number
    if (thirdType === 1) {
      const local = reader.compressedU32('cLocal3rdPos')
      if (local >= localPositions.length) throw new Error(`${reader.label}: local third position is outside the neighborhood`)
      third = localPositions[local]!
    } else if (thirdType === 2) {
      third = reader.compressedU32(resolution)
      if (third >= resolution) throw new Error(`${reader.label}: global third position is outside the current mesh`)
      insertDescending(localPositions, third)
    } else throw new Error(`${reader.label}: invalid third position type`)
    if (orientation === 1) leftThird.add(third); else rightThird.add(third)
    const face: U3dMeshFace = {
      shading: shadingIndex,
      positions: orientation === 1 ? [split, resolution, third] : [resolution, split, third],
      normals: [0, 0, 0],
      textures: new Array<Array<number>>(shading.textureDimensions.length) as Array<[number, number, number]>,
    }
    if ((shading.attributes & 1) !== 0) face.diffuse = [0, 0, 0]
    if ((shading.attributes & 2) !== 0) face.specular = [0, 0, 0]
    for (let layer = 0; layer < shading.textureDimensions.length; layer++) face.textures[layer] = [0, 0, 0]
    state.faces.push(face)
  }

  const moveFaces: number[] = []
  const movePositions = new Set<number>()
  const stayPositions = new Set<number>()
  for (let index = 0; index < splitFaces.length; index++) {
    const faceIndex = splitFaces[index]!
    const face = state.faces[faceIndex]!
    const prediction = predictStayMove(face.positions, split, leftThird, rightThird, movePositions, stayPositions)
    const stayMove = reader.compressedU8(`cStayMove${prediction}`)
    if (stayMove !== 0 && stayMove !== 1) throw new Error(`${reader.label}: invalid Stay Or Move value`)
    const target = stayMove === 1 ? movePositions : stayPositions
    for (let corner = 0; corner < 3; corner++) if (face.positions[corner] !== split) target.add(face.positions[corner]!)
    if (stayMove === 1) moveFaces.push(faceIndex)
  }

  for (let index = 0; index < moveFaces.length; index++) {
    const face = state.faces[moveFaces[index]!]!
    const corner = face.positions.indexOf(split)
    if (corner < 0) throw new Error(`${reader.label}: move face does not contain the split position`)
    if (face.diffuse !== undefined) face.diffuse[corner] = readChangedAttribute(reader, face.diffuse[corner]!, state.diffuseColors.length, newDiffuseStart, attributeIndicesAtPosition(state.faces, split, 'diffuse'), 'cDiffuse')
    if (face.specular !== undefined) face.specular[corner] = readChangedAttribute(reader, face.specular[corner]!, state.specularColors.length, newSpecularStart, attributeIndicesAtPosition(state.faces, split, 'specular'), 'cSpecular')
    for (let layer = 0; layer < face.textures.length; layer++) {
      face.textures[layer]![corner] = readChangedAttribute(reader, face.textures[layer]![corner]!, state.textureCoordinates.length, newTextureStart, textureIndicesAtPosition(state.faces, split, layer), 'cTC')
    }
    face.positions[corner] = resolution
  }

  for (let faceIndex = newFaceStart; faceIndex < state.faces.length; faceIndex++) {
    const face = state.faces[faceIndex]!
    if (face.diffuse !== undefined) {
      const values = readNewFaceAttribute(reader, face, split, state.faces, state.diffuseColors.length, 'diffuse', previous.diffuseSplit, previous.diffuseNew, previous.diffuseThird)
      face.diffuse = values.indices; previous.diffuseSplit = values.previous[0]; previous.diffuseNew = values.previous[1]; previous.diffuseThird = values.previous[2]
    }
    if (face.specular !== undefined) {
      const values = readNewFaceAttribute(reader, face, split, state.faces, state.specularColors.length, 'specular', previous.specularSplit, previous.specularNew, previous.specularThird)
      face.specular = values.indices; previous.specularSplit = values.previous[0]; previous.specularNew = values.previous[1]; previous.specularThird = values.previous[2]
    }
    for (let layer = 0; layer < face.textures.length; layer++) {
      const values = readNewFaceTexture(reader, face, split, layer, state.faces, state.textureCoordinates.length, previous.textureSplit, previous.textureNew, previous.textureThird)
      face.textures[layer] = values.indices; previous.textureSplit = values.previous[0]; previous.textureNew = values.previous[1]; previous.textureThird = values.previous[2]
    }
  }

  const prediction = resolution === 0 ? [0, 0, 0] as Pdf3DVector3 : state.positions[split]!
  const signs = reader.compressedU8('cPosDiffSign')
  state.positions.push([
    inverseQuant(prediction[0], signs & 1, reader.compressedU32('cPosDiffX'), state.declaration.positionInverseQuant),
    inverseQuant(prediction[1], (signs >>> 1) & 1, reader.compressedU32('cPosDiffY'), state.declaration.positionInverseQuant),
    inverseQuant(prediction[2], (signs >>> 2) & 1, reader.compressedU32('cPosDiffZ'), state.declaration.positionInverseQuant),
  ])
  if ((state.declaration.meshAttributes & 1) === 0) readProgressiveNormals(reader, state, resolution)
}

function readNewQuantizedVectors(
  reader: U3dBitReader,
  pool: Array<[number, number, number, number]>,
  count: number,
  prediction: [number, number, number, number],
  signContext: string,
  differencePrefix: string,
  inverse: number,
): void {
  for (let index = 0; index < count; index++) {
    const signs = reader.compressedU8(signContext)
    pool.push([
      inverseQuant(prediction[0], signs & 1, reader.compressedU32(`${differencePrefix}0`), inverse),
      inverseQuant(prediction[1], (signs >>> 1) & 1, reader.compressedU32(`${differencePrefix}1`), inverse),
      inverseQuant(prediction[2], (signs >>> 2) & 1, reader.compressedU32(`${differencePrefix}2`), inverse),
      inverseQuant(prediction[3], (signs >>> 3) & 1, reader.compressedU32(`${differencePrefix}3`), inverse),
    ])
  }
}

function readChangedAttribute(reader: U3dBitReader, current: number, poolCount: number, newStart: number, local: number[], prefix: 'cDiffuse' | 'cSpecular' | 'cTC'): number {
  const keepChange = reader.compressedU8(`${prefix}KeepChange`)
  if (keepChange === 2) return current
  if (keepChange !== 1) throw new Error(`${reader.label}: invalid attribute Keep/Change value`)
  const type = reader.compressedU8(`${prefix}ChangeType`)
  let value: number
  if (type === 1) value = newStart + reader.compressedU32(`${prefix}ChangeIndexNew`)
  else if (type === 2) {
    const index = reader.compressedU32(`${prefix}ChangeIndexLocal`)
    if (index >= local.length) throw new Error(`${reader.label}: local changed attribute is outside the neighborhood`)
    value = local[index]!
  } else if (type === 3) value = reader.compressedU32(`${prefix}ChangeIndexGlobal`)
  else throw new Error(`${reader.label}: invalid attribute change type`)
  if (value >= poolCount) throw new Error(`${reader.label}: changed attribute is outside its pool`)
  return value
}

function readNewFaceAttribute(
  reader: U3dBitReader,
  face: U3dMeshFace,
  split: number,
  faces: U3dMeshFace[],
  poolCount: number,
  kind: 'diffuse' | 'specular',
  previousSplit: number,
  previousNew: number,
  previousThird: number,
): { indices: [number, number, number]; previous: [number, number, number] } {
  const duplicate = reader.compressedU8('cColorDup')
  if ((duplicate & ~7) !== 0) throw new Error(`${reader.label}: reserved color duplicate flags are set`)
  const splitCorner = face.positions.indexOf(split)
  const newCorner = face.positions.findIndex(function (value) { return value !== split && value === Math.max(...face.positions) })
  const thirdCorner = 3 - splitCorner - newCorner
  const result: [number, number, number] = [0, 0, 0]
  const roles: Array<[number, number, number]> = [[splitCorner, 1, previousSplit], [newCorner, 2, previousNew], [thirdCorner, 4, previousThird]]
  for (let index = 0; index < roles.length; index++) {
    const role = roles[index]!
    const position = face.positions[role[0]]!
    const local = attributeIndicesAtPosition(faces, position, kind, face)
    const value = (duplicate & role[1]) !== 0 ? role[2] : readLocalOrGlobalIndex(reader, local, poolCount, 'cColorIndexType', 'cColorIndexLocal', 'cColorIndexGlobal')
    if (value >= poolCount) throw new Error(`${reader.label}: face color is outside its pool`)
    result[role[0]] = value
    role[2] = value
  }
  return { indices: result, previous: [roles[0]![2], roles[1]![2], roles[2]![2]] }
}

function readNewFaceTexture(
  reader: U3dBitReader,
  face: U3dMeshFace,
  split: number,
  layer: number,
  faces: U3dMeshFace[],
  poolCount: number,
  previousSplit: number,
  previousNew: number,
  previousThird: number,
): { indices: [number, number, number]; previous: [number, number, number] } {
  const duplicate = reader.compressedU8('cTexCDup')
  if ((duplicate & ~7) !== 0) throw new Error(`${reader.label}: reserved texture duplicate flags are set`)
  const splitCorner = face.positions.indexOf(split)
  const newCorner = face.positions.findIndex(function (value) { return value !== split && value === Math.max(...face.positions) })
  const thirdCorner = 3 - splitCorner - newCorner
  const result: [number, number, number] = [0, 0, 0]
  const roles: Array<[number, number, number]> = [[splitCorner, 1, previousSplit], [newCorner, 2, previousNew], [thirdCorner, 4, previousThird]]
  for (let index = 0; index < roles.length; index++) {
    const role = roles[index]!
    const local = textureIndicesAtPosition(faces, face.positions[role[0]]!, layer, face)
    const value = (duplicate & role[1]) !== 0 ? role[2] : readLocalOrGlobalIndex(reader, local, poolCount, 'cTextureIndexType', 'cTextureIndexLocal', 'cTextureIndexGlobal')
    if (value >= poolCount) throw new Error(`${reader.label}: face texture coordinate is outside its pool`)
    result[role[0]] = value
    role[2] = value
  }
  return { indices: result, previous: [roles[0]![2], roles[1]![2], roles[2]![2]] }
}

function readLocalOrGlobalIndex(reader: U3dBitReader, local: number[], poolCount: number, typeContext: string, localContext: string, globalContext: string): number {
  const type = reader.compressedU8(typeContext)
  if (type === 2) {
    const index = reader.compressedU32(localContext)
    if (index >= local.length) throw new Error(`${reader.label}: local attribute index is outside the neighborhood`)
    return local[index]!
  }
  if (type === 3) {
    const value = reader.compressedU32(globalContext)
    if (value >= poolCount) throw new Error(`${reader.label}: global attribute index is outside its pool`)
    return value
  }
  throw new Error(`${reader.label}: invalid local/global attribute type`)
}

function readProgressiveNormals(reader: U3dBitReader, state: U3dMeshState, newPosition: number): void {
  const neighborhood = positionsUsedByFaces(state.faces, facesUsingPosition(state.faces, newPosition), -1)
  insertDescending(neighborhood, newPosition)
  for (let positionIndex = 0; positionIndex < neighborhood.length; positionIndex++) {
    const position = neighborhood[positionIndex]!
    const newCount = reader.compressedU32('cNormlCnt')
    const start = state.normals.length
    for (let index = 0; index < newCount; index++) {
      const signs = reader.compressedU8('cDiffNormalSign')
      state.normals.push([
        inverseQuant(0, signs & 1, reader.compressedU32('cDiffNormalX'), state.declaration.normalInverseQuant),
        inverseQuant(0, (signs >>> 1) & 1, reader.compressedU32('cDiffNormalY'), state.declaration.normalInverseQuant),
        inverseQuant(0, (signs >>> 2) & 1, reader.compressedU32('cDiffNormalZ'), state.declaration.normalInverseQuant),
      ])
    }
    const faceIndices = facesUsingPosition(state.faces, position)
    for (let faceOffset = 0; faceOffset < faceIndices.length; faceOffset++) {
      const local = reader.compressedU32('cNormlIdx')
      if (local >= newCount) throw new Error(`${reader.label}: local normal index is outside the new normal array`)
      const face = state.faces[faceIndices[faceOffset]!]!
      const corner = face.positions.indexOf(position)
      face.normals[corner] = start + local
    }
  }
}

function predictStayMove(face: [number, number, number], split: number, left: Set<number>, right: Set<number>, move: Set<number>, stay: Set<number>): number {
  const corner = face.indexOf(split)
  const next = face[(corner + 1) % 3]!, previous = face[(corner + 2) % 3]!
  if (right.has(next)) return 1
  if (right.has(previous)) return 2
  if (left.has(next)) return 2
  if (left.has(previous)) return 1
  if (move.has(face[0]) || move.has(face[1]) || move.has(face[2])) return 3
  if (stay.has(face[0]) || stay.has(face[1]) || stay.has(face[2])) return 4
  return 0
}

function facesUsingPosition(faces: U3dMeshFace[], position: number): number[] {
  const result: number[] = []
  for (let index = faces.length - 1; index >= 0; index--) if (faces[index]!.positions.includes(position)) result.push(index)
  return result
}

function positionsUsedByFaces(faces: U3dMeshFace[], faceIndices: number[], excluded: number): number[] {
  const values = new Set<number>()
  for (let index = 0; index < faceIndices.length; index++) for (const position of faces[faceIndices[index]!]!.positions) if (position !== excluded) values.add(position)
  return [...values].sort(function (a, b) { return b - a })
}

function attributeIndicesAtPosition(faces: U3dMeshFace[], position: number, kind: 'diffuse' | 'specular', excluded?: U3dMeshFace): number[] {
  const values = new Set<number>()
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex]!
    if (face === excluded) continue
    const attributes = face[kind]
    if (attributes === undefined) continue
    for (let corner = 0; corner < 3; corner++) if (face.positions[corner] === position) values.add(attributes[corner]!)
  }
  return [...values].sort(function (a, b) { return b - a })
}

function textureIndicesAtPosition(faces: U3dMeshFace[], position: number, layer: number, excluded?: U3dMeshFace): number[] {
  const values = new Set<number>()
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex]!
    if (face === excluded) continue
    const attributes = face.textures[layer]
    if (attributes === undefined) continue
    for (let corner = 0; corner < 3; corner++) if (face.positions[corner] === position) values.add(attributes[corner]!)
  }
  return [...values].sort(function (a, b) { return b - a })
}

function averageVectors(pool: Array<[number, number, number, number]>, indices: number[]): [number, number, number, number] {
  const result: [number, number, number, number] = [0, 0, 0, 0]
  if (indices.length === 0) return result
  for (let index = 0; index < indices.length; index++) {
    const value = pool[indices[index]!]!
    for (let component = 0; component < 4; component++) result[component] = result[component]! + value[component]!
  }
  for (let component = 0; component < 4; component++) result[component] = result[component]! / indices.length
  return result
}

function insertDescending(values: number[], value: number): void {
  if (values.includes(value)) return
  let index = 0
  while (index < values.length && values[index]! > value) index++
  values.splice(index, 0, value)
}

function readVectors3(reader: U3dBitReader, count: number): Pdf3DVector3[] {
  const result = new Array<Pdf3DVector3>(count)
  for (let index = 0; index < count; index++) result[index] = [reader.f32(), reader.f32(), reader.f32()]
  return result
}

function readVectors4(reader: U3dBitReader, count: number): Array<[number, number, number, number]> {
  const result = new Array<[number, number, number, number]>(count)
  for (let index = 0; index < count; index++) result[index] = [reader.f32(), reader.f32(), reader.f32(), reader.f32()]
  return result
}

function readColors(reader: U3dBitReader, count: number): Array<[number, number, number, number]> {
  return readVectors4(reader, count)
}

function readStaticIndex(reader: U3dBitReader, count: number, label: string): number {
  if (count === 0) throw new Error(`${reader.label}: ${label} index is present for an empty array`)
  const value = reader.compressedU32(count)
  if (value >= count) throw new Error(`${reader.label}: ${label} index ${value} is outside ${count} entries`)
  return value
}

function positiveQuant(value: number, label: string, kind: string): number {
  if (value <= 0) throw new Error(`${label}: ${kind} Inverse Quant must be positive`)
  return value
}

function readSkeletonDescription(reader: U3dReader): void {
  const boneCount = reader.u32()
  const names = new Set<string>()
  for (let index = 0; index < boneCount; index++) {
    const name = requiredObjectName(reader.string(), reader.label)
    if (names.has(name)) throw new Error(`${reader.label}: duplicate bone ${JSON.stringify(name)}`)
    const parent = reader.string()
    if (index === 0 ? parent !== '' : !names.has(parent)) throw new Error(`${reader.label}: invalid parent for bone ${JSON.stringify(name)}`)
    names.add(name)
    const attributes = reader.u32()
    if ((attributes & ~0xFF) !== 0) throw new Error(`${reader.label}: reserved Bone Attributes are set`)
    reader.f32()
    reader.f32(); reader.f32(); reader.f32()
    reader.f32(); reader.f32(); reader.f32(); reader.f32()
    if ((attributes & 1) !== 0) { reader.u32(); reader.f32() }
    if ((attributes & 2) !== 0) for (let value = 0; value < 8; value++) reader.f32()
    for (let axis = 0; axis < 3; axis++) if ((attributes & (4 << (axis * 2))) !== 0) { reader.f32(); reader.f32() }
  }
}

function readMaterialResource(block: U3dBlock): U3dMaterialResource {
  const reader = new U3dReader(block.data, `U3D Material Resource at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  const attributes = reader.u32()
  if ((attributes & ~0x3F) !== 0) throw new Error(`${reader.label}: reserved Material Attributes are set`)
  const ambient: Pdf3DVector3 = [reader.f32(), reader.f32(), reader.f32()]
  const diffuse: Pdf3DVector3 = [reader.f32(), reader.f32(), reader.f32()]
  const specular: Pdf3DVector3 = [reader.f32(), reader.f32(), reader.f32()]
  const emissive: Pdf3DVector3 = [reader.f32(), reader.f32(), reader.f32()]
  const reflectivity = reader.f32()
  const opacity = reader.f32()
  reader.finish()
  return { name, attributes, ambient, diffuse, specular, emissive, reflectivity, opacity }
}

function readLightResource(block: U3dBlock): U3dLightResource {
  const reader = new U3dReader(block.data, `U3D Light Resource at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  const attributes = reader.u32()
  if ((attributes & ~7) !== 0) throw new Error(`${reader.label}: reserved Light Attributes are set`)
  const type = reader.u8()
  if (type > 3) throw new Error(`${reader.label}: invalid Light Type ${type}`)
  const color: Pdf3DVector3 = [reader.f32(), reader.f32(), reader.f32()]
  reader.f32()
  const attenuation: Pdf3DVector3 = [reader.f32(), reader.f32(), reader.f32()]
  const spotAngle = reader.f32()
  const intensity = reader.f32()
  reader.finish()
  return { name, attributes, type: type as 0 | 1 | 2 | 3, color, attenuation, spotAngle, intensity }
}

function readTextureDeclaration(block: U3dBlock): U3dTextureResource {
  const reader = new U3dReader(block.data, `U3D Texture Declaration at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  const height = reader.u32(), width = reader.u32()
  if (width === 0 || height === 0) throw new Error(`${reader.label}: texture dimensions must be positive`)
  const imageType = reader.u8()
  if (![0x01, 0x0E, 0x0F, 0x10, 0x11].includes(imageType)) throw new Error(`${reader.label}: invalid texture image type`)
  const count = reader.u32()
  const formats = new Array<U3dTextureContinuationFormat>(count)
  const chunks = new Array<Uint8Array[]>(count)
  let composedChannels = 0
  for (let index = 0; index < count; index++) {
    const compression = reader.u8()
    const channels = reader.u8()
    const attributes = reader.u16()
    if (compression < 1 || compression > 4 || channels === 0 || (channels & ~0x1F) !== 0 || (attributes & ~1) !== 0) {
      throw new Error(`${reader.label}: invalid continuation image format`)
    }
    if ((composedChannels & channels) !== 0) throw new Error(`${reader.label}: texture channel is supplied by more than one continuation image`)
    composedChannels |= channels
    let byteCount = 0
    const urls: string[] = []
    if ((attributes & 1) === 0) byteCount = reader.u32()
    else {
      const urlCount = reader.u32()
      for (let url = 0; url < urlCount; url++) urls.push(reader.string())
      if (urls.length === 0) throw new Error(`${reader.label}: external continuation image has no URL`)
    }
    formats[index] = { compression: compression as 1 | 2 | 3 | 4, channels, attributes, byteCount, urls }
    chunks[index] = []
  }
  reader.finish()
  return { name, height, width, imageType, formats, chunks }
}

function readTextureContinuation(block: U3dBlock, resources: Map<string, U3dTextureResource>): void {
  const reader = new U3dReader(block.data, `U3D Texture Continuation at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  const resource = resources.get(name)
  if (resource === undefined) throw new Error(`${reader.label}: no texture declaration exists for ${JSON.stringify(name)}`)
  const imageIndex = reader.u32()
  const chunks = resource.chunks[imageIndex]
  if (chunks === undefined) throw new Error(`${reader.label}: continuation image index is outside the texture declaration`)
  chunks.push(reader.take(reader.remaining))
}

function decodeU3dTexture(
  resource: U3dTextureResource,
  resolveExternalTexture: U3dDecodeOptions['resolveExternalTexture'],
): Pdf3DTextureImage {
  const rgba = new Uint8Array(resource.width * resource.height * 4)
  for (let pixel = 0; pixel < resource.width * resource.height; pixel++) rgba[pixel * 4 + 3] = 255
  for (let index = 0; index < resource.formats.length; index++) {
    const format = resource.formats[index]!
    const chunks = resource.chunks[index]!
    let encoded: Uint8Array
    if ((format.attributes & 1) !== 0) {
      if (chunks.length !== 0) throw new Error(`U3D texture ${JSON.stringify(resource.name)} external image has embedded continuation bytes`)
      if (resolveExternalTexture === undefined) throw new Error(`U3D texture ${JSON.stringify(resource.name)} requires an external texture resolver`)
      encoded = resolveExternalTexture(format.urls, resource.name, index)
      if (!(encoded instanceof Uint8Array)) throw new Error(`U3D texture ${JSON.stringify(resource.name)} external resolver did not return bytes`)
    } else {
      let length = 0
      for (let chunk = 0; chunk < chunks.length; chunk++) length += chunks[chunk]!.length
      if (length !== format.byteCount) throw new Error(`U3D texture ${JSON.stringify(resource.name)} continuation byte count does not match its declaration`)
      encoded = new Uint8Array(length)
      let offset = 0
      for (let chunk = 0; chunk < chunks.length; chunk++) { encoded.set(chunks[chunk]!, offset); offset += chunks[chunk]!.length }
    }
    let decoded: Pdf3DTextureImage
    if (format.compression === 1 || format.compression === 3) {
      const image = decodeJpegToRgba(encoded); decoded = { width: image.width, height: image.height, rgba: image.rgba }
    } else if (format.compression === 2) {
      const image = decodePng(encoded); decoded = { width: image.width, height: image.height, rgba: image.pixels }
    } else {
      const image = decodeTiffToRgba(encoded); decoded = { width: image.width, height: image.height, rgba: image.data }
    }
    if (decoded.width !== resource.width || decoded.height !== resource.height) throw new Error(`U3D texture ${JSON.stringify(resource.name)} continuation dimensions do not match its declaration`)
    for (let pixel = 0; pixel < resource.width * resource.height; pixel++) {
      const source = pixel * 4, target = source
      const luminance = decoded.rgba[source]!
      if ((format.channels & 0x10) !== 0) { rgba[target] = luminance; rgba[target + 1] = luminance; rgba[target + 2] = luminance }
      if ((format.channels & 0x08) !== 0) rgba[target] = decoded.rgba[source]!
      if ((format.channels & 0x04) !== 0) rgba[target + 1] = decoded.rgba[source + 1]!
      if ((format.channels & 0x02) !== 0) rgba[target + 2] = decoded.rgba[source + 2]!
      if ((format.channels & 0x01) !== 0) rgba[target + 3] = decoded.rgba[source + 3]!
    }
  }
  return { width: resource.width, height: resource.height, rgba }
}

function readLitTextureShader(block: U3dBlock): U3dLitTextureShader {
  const reader = new U3dReader(block.data, `U3D Lit Texture Shader at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  const attributes = reader.u32()
  if ((attributes & ~7) !== 0) throw new Error(`${reader.label}: reserved Shader Attributes are set`)
  const alphaReference = reader.f32()
  const alphaCompare = reader.u32()
  if (alphaCompare < 0x0610 || alphaCompare > 0x0617) throw new Error(`${reader.label}: invalid alpha-test function`)
  const frameBufferBlend = reader.u32()
  if (![0x0604, 0x0605, 0x0606, 0x0607, 0x0608, 0x0609, 0x06AA].includes(frameBufferBlend)) {
    throw new Error(`${reader.label}: invalid frame-buffer blend function`)
  }
  const renderPassFlags = reader.u32()
  const channels = reader.u32()
  const alphaTextureChannels = reader.u32()
  if ((channels & ~0xFF) !== 0 || (alphaTextureChannels & ~channels) !== 0) throw new Error(`${reader.label}: invalid texture-channel masks`)
  const materialName = requiredObjectName(reader.string(), reader.label)
  const layers: U3dTextureLayerDefinition[] = []
  for (let channel = 0; channel < 8; channel++) {
    if ((channels & (1 << channel)) === 0) continue
    const textureName = requiredObjectName(reader.string(), reader.label)
    const intensity = reader.f32()
    const blendFunction = reader.u8()
    const blendSource = reader.u8()
    const blendConstant = reader.f32()
    const textureMode = reader.u8()
    if (blendFunction > 3 || blendSource > 1 || textureMode > 4) throw new Error(`${reader.label}: invalid texture-layer rendering mode`)
    const textureTransform = new Array<number>(16)
    const wrapTransform = new Array<number>(16)
    for (let element = 0; element < 16; element++) textureTransform[element] = reader.f32()
    for (let element = 0; element < 16; element++) wrapTransform[element] = reader.f32()
    const repeat = reader.u8()
    if ((repeat & ~3) !== 0) throw new Error(`${reader.label}: reserved Texture Repeat bits are set`)
    layers.push({
      channel, textureName, intensity, blendFunction: blendFunction as 0 | 1 | 2 | 3,
      blendSource: blendSource as 0 | 1, blendConstant, textureMode: textureMode as 0 | 1 | 2 | 3 | 4,
      textureTransform: textureTransform as Pdf3DMatrix4, wrapTransform: wrapTransform as Pdf3DMatrix4, repeat,
    })
  }
  reader.finish()
  return { name, attributes, alphaReference, alphaCompare, frameBufferBlend, renderPassFlags, channels, alphaTextureChannels, materialName, layers }
}

function readShadingModifier(block: U3dBlock): U3dShadingModifier {
  const reader = new U3dReader(block.data, `U3D Shading Modifier at ${block.offset}`)
  const targetName = requiredObjectName(reader.string(), reader.label)
  const chainPosition = reader.u32()
  const attributes = reader.u32()
  if ((attributes & ~0x0F) !== 0) throw new Error(`${reader.label}: reserved Shading Attributes are set`)
  const listCount = reader.u32()
  const shaderLists = new Array<string[]>(listCount)
  for (let list = 0; list < listCount; list++) {
    const count = reader.u32()
    const names = new Array<string>(count)
    for (let index = 0; index < count; index++) names[index] = requiredObjectName(reader.string(), reader.label)
    shaderLists[list] = names
  }
  reader.finish()
  return { targetName, chainPosition, attributes, shaderLists }
}

function readNode(block: U3dBlock): Pdf3DSceneNode | null {
  if (block.type !== U3D_GROUP_NODE && block.type !== U3D_MODEL_NODE && block.type !== U3D_LIGHT_NODE && block.type !== U3D_VIEW_NODE) return null
  const reader = new U3dReader(block.data, `U3D node at ${block.offset}`)
  const name = requiredObjectName(reader.string(), reader.label)
  const parents = readParents(reader)
  if (block.type === U3D_GROUP_NODE) {
    reader.finish()
    return { kind: 'group', name, parents, sourceBlockOffset: block.offset }
  }
  const resourceName = reader.string()
  if (block.type === U3D_MODEL_NODE) {
    const visibility = reader.u32()
    if (visibility !== 0 && visibility !== 1 && visibility !== 2 && visibility !== 3) throw new Error(`${reader.label}: invalid Model Visibility`)
    reader.finish()
    return { kind: 'model', name, parents, resourceName, visibility, sourceBlockOffset: block.offset }
  }
  if (block.type === U3D_LIGHT_NODE) {
    reader.finish()
    return { kind: 'light', name, parents, resourceName, sourceBlockOffset: block.offset }
  }
  const attributes = reader.u32()
  if ((attributes & ~7) !== 0) throw new Error(`${reader.label}: invalid View Node Attributes`)
  const projectionBits = attributes & 6
  const projection = projectionBits === 0 ? 'perspective' : projectionBits === 2 ? 'orthographic' : projectionBits === 4 ? 'two-point' : 'one-point'
  const nearClip = reader.f32()
  const farClip = reader.f32()
  if (nearClip < 0 || farClip <= nearClip) throw new Error(`${reader.label}: invalid view clipping distances`)
  const projectionValue: number | Pdf3DVector3 = projection === 'perspective' || projection === 'orthographic'
    ? reader.f32()
    : [reader.f32(), reader.f32(), reader.f32()]
  if (typeof projectionValue === 'number') {
    if (projection === 'perspective' && (projectionValue <= 0 || projectionValue >= 180)) throw new Error(`${reader.label}: perspective field of view must be between 0 and 180 degrees`)
    if (projection === 'orthographic' && projectionValue <= 0) throw new Error(`${reader.label}: orthographic height must be positive`)
  } else if (projectionValue[0] === 0 && projectionValue[1] === 0 && projectionValue[2] === 0) {
    throw new Error(`${reader.label}: projection vector must not be zero`)
  }
  const viewport: [number, number, number, number] = [reader.f32(), reader.f32(), reader.f32(), reader.f32()]
  if (viewport[0] <= 0 || viewport[1] <= 0) throw new Error(`${reader.label}: view viewport dimensions must be positive`)
  const backdrops = readTextureLayers(reader, reader.u32())
  const overlays = readTextureLayers(reader, reader.u32())
  reader.finish()
  return {
    kind: 'view', name, parents, resourceName,
    screenUnits: (attributes & 1) === 0 ? 'pixels' : 'fraction',
    projection, nearClip, farClip, projectionValue, viewport, backdrops, overlays,
    sourceBlockOffset: block.offset,
  }
}

function readParents(reader: U3dReader): Pdf3DParentTransform[] {
  const count = reader.u32()
  const parents = new Array<Pdf3DParentTransform>(count)
  const names = new Set<string>()
  for (let index = 0; index < count; index++) {
    const name = reader.string()
    if (names.has(name)) throw new Error(`${reader.label}: duplicate parent ${JSON.stringify(name)}`)
    names.add(name)
    const values = new Array<number>(16)
    for (let element = 0; element < 16; element++) values[element] = reader.f32()
    parents[index] = { name, matrix: values as Pdf3DMatrix4 }
  }
  return parents
}

function readTextureLayers(reader: U3dReader, count: number): U3dViewTextureLayer[] {
  const layers = new Array<U3dViewTextureLayer>(count)
  for (let index = 0; index < count; index++) {
    const textureName = reader.string()
    const blend = reader.f32()
    const rotation = reader.f32()
    const location: [number, number] = [reader.f32(), reader.f32()]
    const registration: [number, number] = [reader.i32(), reader.i32()]
    const scale: [number, number] = [reader.f32(), reader.f32()]
    layers[index] = { textureName, blend, rotation, location, registration, scale }
  }
  return layers
}

function readBoundingSphere(reader: U3dReader): Pdf3DBoundingSphere {
  const center: Pdf3DVector3 = [reader.f32(), reader.f32(), reader.f32()]
  const radius = reader.f32()
  if (radius < 0) throw new Error(`${reader.label}: bounding sphere radius must not be negative`)
  return { center, radius }
}

function readBoundingBox(reader: U3dReader): Pdf3DBoundingBox {
  const minimum: Pdf3DVector3 = [reader.f32(), reader.f32(), reader.f32()]
  const maximum: Pdf3DVector3 = [reader.f32(), reader.f32(), reader.f32()]
  for (let axis = 0; axis < 3; axis++) {
    if (minimum[axis]! > maximum[axis]!) throw new Error(`${reader.label}: inverted bounding box`)
  }
  return { minimum, maximum }
}

function validateNodeGraph(nodes: Map<string, Pdf3DSceneNode>): void {
  const state = new Map<string, number>()
  function visit(name: string): void {
    const current = state.get(name) ?? 0
    if (current === 1) throw new Error(`U3D decode error: recursive parent-child relationship at ${JSON.stringify(name)}`)
    if (current === 2) return
    state.set(name, 1)
    const node = nodes.get(name)!
    for (let index = 0; index < node.parents.length; index++) {
      const parent = node.parents[index]!.name
      if (parent !== '' && nodes.has(parent)) visit(parent)
    }
    state.set(name, 2)
  }
  for (const name of nodes.keys()) visit(name)
}

function combineBounds(chains: U3dModifierChain[]): Pdf3DBoundingBox | null {
  let result: Pdf3DBoundingBox | null = null
  for (let index = 0; index < chains.length; index++) {
    const chain = chains[index]!
    let bounds = chain.boundingBox
    if (bounds === undefined && chain.boundingSphere !== undefined) {
      const sphere = chain.boundingSphere
      bounds = {
        minimum: [sphere.center[0] - sphere.radius, sphere.center[1] - sphere.radius, sphere.center[2] - sphere.radius],
        maximum: [sphere.center[0] + sphere.radius, sphere.center[1] + sphere.radius, sphere.center[2] + sphere.radius],
      }
    }
    if (bounds === undefined) continue
    if (result === null) {
      result = { minimum: [...bounds.minimum] as Pdf3DVector3, maximum: [...bounds.maximum] as Pdf3DVector3 }
    } else {
      for (let axis = 0; axis < 3; axis++) {
        result.minimum[axis] = Math.min(result.minimum[axis]!, bounds.minimum[axis]!)
        result.maximum[axis] = Math.max(result.maximum[axis]!, bounds.maximum[axis]!)
      }
    }
  }
  return result
}

function boundsFromPrimitives(primitives: Pdf3DPrimitive[]): Pdf3DBoundingBox | null {
  let result: Pdf3DBoundingBox | null = null
  for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex++) {
    const positions = primitives[primitiveIndex]!.positions
    for (let index = 0; index < positions.length; index++) {
      const point = positions[index]!
      if (result === null) result = { minimum: [...point] as Pdf3DVector3, maximum: [...point] as Pdf3DVector3 }
      else {
        for (let axis = 0; axis < 3; axis++) {
          result.minimum[axis] = Math.min(result.minimum[axis]!, point[axis]!)
          result.maximum[axis] = Math.max(result.maximum[axis]!, point[axis]!)
        }
      }
    }
  }
  return result
}

function unionBounds(a: Pdf3DBoundingBox, b: Pdf3DBoundingBox): Pdf3DBoundingBox {
  return {
    minimum: [Math.min(a.minimum[0], b.minimum[0]), Math.min(a.minimum[1], b.minimum[1]), Math.min(a.minimum[2], b.minimum[2])],
    maximum: [Math.max(a.maximum[0], b.maximum[0]), Math.max(a.maximum[1], b.maximum[1]), Math.max(a.maximum[2], b.maximum[2])],
  }
}

function identityMatrix(): Pdf3DMatrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function multiplyMatrices(a: Pdf3DMatrix4, b: Pdf3DMatrix4): Pdf3DMatrix4 {
  const result = new Array<number>(16)
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let value = 0
      for (let inner = 0; inner < 4; inner++) value += a[inner * 4 + row]! * b[column * 4 + inner]!
      result[column * 4 + row] = value
    }
  }
  return result as Pdf3DMatrix4
}

function transformPoint(matrix: Pdf3DMatrix4, point: Pdf3DVector3): Pdf3DVector3 {
  const x = matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12]
  const y = matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13]
  const z = matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14]
  const w = matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15]
  if (w === 0) throw new Error('PDF 3D transform maps a point to infinity')
  return [x / w, y / w, z / w]
}

function transformVector(matrix: Pdf3DMatrix4, vector: Pdf3DVector3): Pdf3DVector3 {
  return unitVector3([
    matrix[0] * vector[0] + matrix[4] * vector[1] + matrix[8] * vector[2],
    matrix[1] * vector[0] + matrix[5] * vector[1] + matrix[9] * vector[2],
    matrix[2] * vector[0] + matrix[6] * vector[1] + matrix[10] * vector[2],
  ], 'PDF 3D transformed vector')
}

function transformNormal(matrix: Pdf3DMatrix4, normal: Pdf3DVector3): Pdf3DVector3 {
  const inverse = invertMatrix(matrix)
  return unitVector3([
    inverse[0] * normal[0] + inverse[1] * normal[1] + inverse[2] * normal[2],
    inverse[4] * normal[0] + inverse[5] * normal[1] + inverse[6] * normal[2],
    inverse[8] * normal[0] + inverse[9] * normal[1] + inverse[10] * normal[2],
  ], 'PDF 3D transformed normal')
}

function subtractVector3(a: Pdf3DVector3, b: Pdf3DVector3): Pdf3DVector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function requiredObjectName(name: string, label: string): string {
  if (name.length === 0) throw new Error(`${label}: object name must not be empty`)
  return name
}

function validatePoint(point: Pdf3DVector3, label: string): void {
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(point[axis])) throw new Error(`PDF 3D measurement ${label} contains a non-finite coordinate`)
  }
}

interface Pdf3DPosterProjection {
  point: (point: Pdf3DVector3) => [number, number]
  depth: (point: Pdf3DVector3) => number
  weight: (point: Pdf3DVector3) => number
}

function posterProjection(scene: Pdf3DDecodedScene): Pdf3DPosterProjection {
  const view = scene.nodes.find(function (node): node is Pdf3DViewNode { return node.kind === 'view' })
  if (view === undefined) return {
    point: function (point) { return [point[0] - point[2] * 0.42, point[1] + point[2] * 0.28] },
    depth: function (point) { return point[2] + point[0] * 0.42 - point[1] * 0.28 },
    weight: function () { return 1 },
  }
  const nodeMap = new Map<string, Pdf3DSceneNode>()
  for (let index = 0; index < scene.nodes.length; index++) nodeMap.set(scene.nodes[index]!.name, scene.nodes[index]!)
  const world = nodeWorldMatrices(view, nodeMap, new Set<string>())[0]
  if (world === undefined) throw new Error(`PDF 3D view ${JSON.stringify(view.name)} has no world transform`)
  const inverse = invertMatrix(world)
  function local(point: Pdf3DVector3): Pdf3DVector3 { return transformPoint(inverse, point) }
  if (view.projection === 'orthographic') return {
    point: function (point) { const value = local(point); return [value[0], value[1]] },
    depth: function (point) { return local(point)[2] },
    weight: function () { return 1 },
  }
  if (view.projection === 'one-point') {
    const normal = unitVector3(view.projectionValue as Pdf3DVector3, `U3D view ${JSON.stringify(view.name)} projection vector`)
    const basis = projectionBasis(normal, Math.abs(normal[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0])
    return perspectiveBasisProjection(local, basis[0], basis[1], normal)
  }
  if (view.projection === 'two-point') {
    const up = unitVector3(view.projectionValue as Pdf3DVector3, `U3D view ${JSON.stringify(view.name)} projection vector`)
    const forwardSeed: Pdf3DVector3 = Math.abs(up[2]) < 0.99 ? [0, 0, -1] : [0, -1, 0]
    const right = unitVector3(crossVector3(up, forwardSeed), `U3D view ${JSON.stringify(view.name)} right vector`)
    const forward = unitVector3(crossVector3(up, right), `U3D view ${JSON.stringify(view.name)} forward vector`)
    return perspectiveBasisProjection(local, right, up, forward)
  }
  const fieldOfView = view.projectionValue as number
  const focal = 1 / Math.tan(fieldOfView * Math.PI / 360)
  return {
    point: function (point) {
      const value = local(point), distance = Math.max(Number.EPSILON, -value[2])
      return [value[0] * focal / distance, value[1] * focal / distance]
    },
    depth: function (point) { return local(point)[2] },
    weight: function (point) { return 1 / Math.max(Number.EPSILON, -local(point)[2]) },
  }
}

function perspectiveBasisProjection(
  local: (point: Pdf3DVector3) => Pdf3DVector3,
  right: Pdf3DVector3,
  up: Pdf3DVector3,
  forward: Pdf3DVector3,
): Pdf3DPosterProjection {
  return {
    point: function (point) {
      const value = local(point)
      const distance = Math.max(Number.EPSILON, -dotVector3(value, forward))
      return [dotVector3(value, right) / distance, dotVector3(value, up) / distance]
    },
    depth: function (point) { return dotVector3(local(point), forward) },
    weight: function (point) { return 1 / Math.max(Number.EPSILON, -dotVector3(local(point), forward)) },
  }
}

function projectionBasis(normal: Pdf3DVector3, upSeed: Pdf3DVector3): [Pdf3DVector3, Pdf3DVector3] {
  const right = unitVector3(crossVector3(upSeed, normal), 'U3D view right vector')
  return [right, unitVector3(crossVector3(normal, right), 'U3D view up vector')]
}

function crossVector3(a: Pdf3DVector3, b: Pdf3DVector3): Pdf3DVector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dotVector3(a: Pdf3DVector3, b: Pdf3DVector3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

function unitVector3(value: Pdf3DVector3, label: string): Pdf3DVector3 {
  const length = Math.sqrt(dotVector3(value, value))
  if (length <= Number.EPSILON) throw new Error(`${label} must not be zero`)
  return [value[0] / length, value[1] / length, value[2] / length]
}

function invertMatrix(matrix: Pdf3DMatrix4): Pdf3DMatrix4 {
  const rows = new Array<number[]>(4)
  for (let row = 0; row < 4; row++) {
    rows[row] = new Array<number>(8)
    for (let column = 0; column < 4; column++) rows[row]![column] = matrix[column * 4 + row]!
    for (let column = 0; column < 4; column++) rows[row]![column + 4] = row === column ? 1 : 0
  }
  for (let column = 0; column < 4; column++) {
    let pivot = column
    for (let row = column + 1; row < 4; row++) if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row
    if (Math.abs(rows[pivot]![column]!) <= Number.EPSILON) throw new Error('PDF 3D view transform is singular')
    const swap = rows[column]!; rows[column] = rows[pivot]!; rows[pivot] = swap
    const divisor = rows[column]![column]!
    for (let index = 0; index < 8; index++) rows[column]![index] = rows[column]![index]! / divisor
    for (let row = 0; row < 4; row++) {
      if (row === column) continue
      const factor = rows[row]![column]!
      for (let index = 0; index < 8; index++) rows[row]![index] = rows[row]![index]! - factor * rows[column]![index]!
    }
  }
  const result = new Array<number>(16)
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) result[column * 4 + row] = rows[row]![column + 4]!
  return result as Pdf3DMatrix4
}

function pdfNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}
