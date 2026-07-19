import { zlibInflate } from '../compression/inflate.js'
import { decodeJpegToRgba } from '../image/jpeg-decoder.js'
import { decodePng } from '../image/png-parser.js'
import { calculatePdf3DSceneBounds } from './pdf-3d.js'
import { readPrcDoubleCode } from './prc-double-codes.js'
import type { Pdf3DClippingPlane, Pdf3DLightSource, Pdf3DMatrix4, Pdf3DPrimitive, Pdf3DRenderPass, Pdf3DSceneNode, Pdf3DSurfaceMaterial, Pdf3DTextureImage, Pdf3DTextureLayer, Pdf3DVector3, Prc3DScene } from './pdf-3d.js'

const PRC_TYPE_ASM_FILE_STRUCTURE_TESSELLATION = 305
const PRC_TYPE_TESS_3D = 172
const PRC_TYPE_TESS_3D_COMPRESSED = 173
const PRC_TYPE_TESS_FACE = 174
const PRC_TYPE_TESS_3D_WIRE = 175
const PRC_TYPE_TESS_MARKUP = 176

interface PrcFileStructureDescription { uuid: Uint8Array; offsets: number[] }
interface PrcGlobals {
  fonts: PrcFont[]
  colors: Array<[number, number, number]>
  coordinates: Pdf3DMatrix4[]
  styles: Array<[number, number, number, number] | null>
  pictures: PrcPicture[]
  textures: PrcTextureDefinition[]
  materials: PrcMaterial[]
  styleDefinitions: PrcStyle[]
}

interface PrcFont { family: string; size: number; attributes: number }

class PrcRawReader {
  private readonly view: DataView
  offset = 0
  constructor(readonly bytes: Uint8Array, readonly label: string) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
  u32(): number { this.require(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value }
  take(length: number): Uint8Array { this.require(length); const value = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return value }
  private require(length: number): void { if (this.offset + length > this.bytes.length) throw new Error(`${this.label}: truncated data at byte ${this.offset}`) }
}

class PrcBitReader {
  private bitPosition = 0
  private currentName = ''
  constructor(readonly bytes: Uint8Array, readonly label: string) {}
  bit(): number {
    if (this.bitPosition >= this.bytes.length * 8) throw new Error(`${this.label}: truncated bit stream`)
    const value = (this.bytes[this.bitPosition >>> 3]! >>> (7 - (this.bitPosition & 7))) & 1
    this.bitPosition++
    return value
  }
  bits(count: number): number { let value = 0; for (let index = 0; index < count; index++) value = value * 2 + this.bit(); return value }
  skipBits(count: number): void { for (let index = 0; index < count; index++) this.bit() }
  boolean(): boolean { return this.bit() !== 0 }
  character(): number { return this.bits(8) }
  floatAsBytes(): number {
    const bytes = new Uint8Array(4)
    for (let index = 0; index < 4; index++) bytes[index] = this.character()
    const value = new DataView(bytes.buffer).getFloat32(0, true)
    if (!Number.isFinite(value)) throw new Error(`${this.label}: non-finite FloatAsBytes value`)
    return value
  }
  variableInteger(bitCount: number): number {
    if (bitCount < 1 || bitCount > 32) throw new Error(`${this.label}: invalid variable integer width ${bitCount}`)
    const negative = this.boolean()
    const magnitude = bitCount === 1 ? 0 : this.bits(bitCount - 1)
    return negative ? -magnitude : magnitude
  }
  characterArray(valueBitCount: number, compressed?: boolean): number[] {
    const isCompressed = compressed ?? this.boolean()
    if (!isCompressed) {
      const count = this.unsigned()
      const result = new Array<number>(count)
      for (let index = 0; index < count; index++) result[index] = this.character()
      return result
    }
    return this.huffmanArray(valueBitCount)
  }
  shortArray(valueBitCount: number): number[] {
    if (this.boolean()) return this.huffmanArray(valueBitCount)
    const count = this.unsigned()
    const result = new Array<number>(count)
    for (let index = 0; index < count; index++) result[index] = this.character() | (this.character() << 8)
    return result
  }
  compressedIntegerArray(): number[] {
    const widths = this.characterArray(6)
    const result = new Array<number>(widths.length)
    for (let index = 0; index < widths.length; index++) result[index] = this.variableInteger(widths[index]!)
    return result
  }
  compressedIndiceArray(compressed?: boolean): number[] {
    const widthDeltas = this.characterArray(6, compressed)
    const result = new Array<number>(widthDeltas.length)
    if (widthDeltas.length === 0) return result
    let width = widthDeltas[0]!
    result[0] = this.variableInteger(width)
    for (let index = 1; index < widthDeltas.length; index++) {
      const raw = widthDeltas[index]!
      width += raw >= 32 ? raw - 64 : raw
      result[index] = result[index - 1]! + this.variableInteger(width)
    }
    return result
  }
  unsigned(): number {
    let value = 0, shift = 0
    while (this.boolean()) {
      value += this.character() * 2 ** shift
      shift += 8
      if (shift > 32) throw new Error(`${this.label}: UnsignedInteger exceeds 32 bits`)
    }
    return value >>> 0
  }
  integer(): number {
    let value = 0, shift = 0, byte = 0
    while (this.boolean()) {
      byte = this.character()
      value += byte * 2 ** shift
      shift += 8
      if (shift > 32) throw new Error(`${this.label}: Integer exceeds 32 bits`)
    }
    return (byte & 0x80) === 0 ? value : value - 2 ** shift
  }
  string(): string | null {
    if (!this.boolean()) return null
    const length = this.unsigned()
    const bytes = new Uint8Array(length)
    for (let index = 0; index < length; index++) bytes[index] = this.character()
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  name(): string {
    if (!this.boolean()) this.currentName = this.string() ?? ''
    return this.currentName
  }
  double(): number {
    const code = readPrcDoubleCode(this.bit.bind(this))
    if (code.value === 0) return 0
    const negative = this.boolean()
    if (code.value !== undefined) return negative ? -code.value : code.value
    const exponent = code.exponent!
    if (!this.boolean()) return wordsToDouble((negative ? 0x80000000 : 0) | (exponent << 20), 0)
    const bytes = new Uint8Array(8)
    bytes[7] = (negative ? 0x80 : 0) | (exponent >>> 4)
    bytes[6] = ((exponent & 15) << 4) | this.bits(4)
    const mantissa: number[] = []
    while (mantissa.length < 6) {
      if (this.boolean()) mantissa.push(this.character())
      else {
        const distance = this.bits(3)
        if (distance === 0) { while (mantissa.length < 6) mantissa.push(mantissa[mantissa.length - 1] ?? 0); break }
        if (distance === 6) {
          while (mantissa.length < 5) mantissa.push(mantissa[mantissa.length - 1] ?? 0)
          mantissa.push(this.character())
          break
        }
        if (distance > mantissa.length) throw new Error(`${this.label}: invalid Double byte reference`)
        mantissa.push(mantissa[mantissa.length - distance]!)
      }
    }
    for (let index = 0; index < 6; index++) bytes[5 - index] = mantissa[index]!
    return new DataView(bytes.buffer).getFloat64(0, true)
  }
  contentPrcBase(referenceable = false): string {
    return this.contentPrcBaseDetails(referenceable).name
  }
  contentPrcBaseDetails(referenceable = false): { name: string; uniqueId: number } {
    const attributeCount = this.unsigned()
    for (let index = 0; index < attributeCount; index++) this.attribute()
    const name = this.name()
    let uniqueId = -1
    if (referenceable) { this.unsigned(); this.unsigned(); uniqueId = this.unsigned() }
    return { name, uniqueId }
  }
  graphics(): PrcGraphics {
    if (!this.boolean()) {
      this.currentGraphics = {
        layer: this.unsigned() - 1,
        style: this.unsigned() - 1,
        behavior: this.character() | (this.character() << 8),
      }
    }
    return { ...this.currentGraphics }
  }
  userData(): void { this.skipBits(this.unsigned()) }
  baseGeometry(): void {
    if (!this.boolean()) return
    const attributeCount = this.unsigned()
    for (let index = 0; index < attributeCount; index++) this.attribute()
    this.name(); this.unsigned()
  }
  private attribute(): void {
    if (this.unsigned() !== 201) throw new Error(`${this.label}: invalid attribute entity`)
    this.attributeEntry()
    const count = this.unsigned()
    for (let index = 0; index < count; index++) {
      this.attributeEntry()
      const type = this.unsigned()
      if (type === 1 || type === 3) this.integer()
      else if (type === 2) this.double()
      else if (type === 4) this.string()
      else throw new Error(`${this.label}: invalid attribute value type ${type}`)
    }
  }
  private attributeEntry(): void { if (this.boolean()) this.unsigned(); else this.string() }
  private huffmanArray(valueBitCount: number): number[] {
    if (valueBitCount < 1 || valueBitCount > 16) throw new Error(`${this.label}: invalid Huffman value width ${valueBitCount}`)
    const wordCount = this.unsigned()
    if (wordCount === 0) throw new Error(`${this.label}: empty Huffman storage`)
    const words = new Array<number>(wordCount)
    for (let index = 0; index < wordCount; index++) words[index] = this.bits(32) >>> 0
    const usedLast = this.unsigned()
    if (usedLast > 32) throw new Error(`${this.label}: invalid Huffman final-word bit count`)
    const bitLength = (wordCount - 1) * 32 + (usedLast === 0 ? 32 : usedLast)
    const packed = new PrcPackedBitReader(words, bitLength, this.label)
    const leafCount = packed.bits(valueBitCount + 1)
    if (leafCount === 0 || leafCount > 2 ** valueBitCount) throw new Error(`${this.label}: invalid Huffman leaf count`)
    const codeLengthWidth = packed.bits(8)
    if (codeLengthWidth === 0 || codeLengthWidth > 6) throw new Error(`${this.label}: invalid Huffman code-length width`)
    const leaves = new Array<PrcHuffmanLeaf>(leafCount)
    for (let index = 0; index < leafCount; index++) {
      const value = packed.bits(valueBitCount)
      const codeLength = packed.bits(codeLengthWidth)
      if (codeLength > 32) throw new Error(`${this.label}: Huffman code exceeds 32 bits`)
      leaves[index] = { value, codeLength, code: packed.bits(codeLength) }
    }
    const outputCount = packed.bits(32)
    const result = new Array<number>(outputCount)
    if (leaves.length === 1 && leaves[0]!.codeLength === 0) {
      result.fill(leaves[0]!.value)
      return result
    }
    for (let output = 0; output < outputCount; output++) {
      let code = 0
      let matched = -1
      for (let length = 1; length <= 32 && matched < 0; length++) {
        code += packed.bit() * 2 ** (length - 1)
        for (let leaf = 0; leaf < leaves.length; leaf++) {
          const candidate = leaves[leaf]!
          if (candidate.codeLength === length && candidate.code === code) { matched = candidate.value; break }
        }
      }
      if (matched < 0) throw new Error(`${this.label}: invalid Huffman code`)
      result[output] = matched
    }
    return result
  }
  private currentGraphics: PrcGraphics = { layer: -1, style: -1, behavior: 1 }
}

interface PrcHuffmanLeaf { value: number; codeLength: number; code: number }

class PrcPackedBitReader {
  private position = 0
  constructor(private readonly words: number[], private readonly bitLength: number, private readonly label: string) {}
  bit(): number {
    if (this.position >= this.bitLength) throw new Error(`${this.label}: truncated Huffman data`)
    const value = (this.words[this.position >>> 5]! >>> (this.position & 31)) & 1
    this.position++
    return value
  }
  bits(count: number): number {
    let value = 0
    for (let index = 0; index < count; index++) value += this.bit() * 2 ** index
    return value >>> 0
  }
}

interface PrcGraphics { layer: number; style: number; behavior: number }

/** Decodes ISO 14739-1 PRC file sections and renderable tessellation primitives. */
export function decodePrcScene(data: Uint8Array): Prc3DScene {
  const reader = new PrcRawReader(data, 'PRC file')
  const signature = reader.take(3)
  if (signature[0] !== 0x50 || signature[1] !== 0x52 || signature[2] !== 0x43) throw new Error('PRC decode error: missing PRC signature')
  const minimalVersion = reader.u32()
  const authoringVersion = reader.u32()
  reader.take(16); reader.take(16)
  const structureCount = reader.u32()
  if (structureCount === 0) throw new Error('PRC decode error: file has no FileStructure')
  const structures = new Array<PrcFileStructureDescription>(structureCount)
  for (let index = 0; index < structureCount; index++) {
    const uuid = reader.take(16)
    if (reader.u32() !== 0) throw new Error('PRC decode error: reserved FileStructureDescription value is nonzero')
    const sectionCount = reader.u32()
    if (sectionCount !== 6) throw new Error('PRC decode error: FileStructure must contain six sections')
    const offsets = new Array<number>(6)
    for (let section = 0; section < 6; section++) offsets[section] = reader.u32()
    structures[index] = { uuid, offsets }
  }
  const modelFileOffset = reader.u32()
  const declaredFileSize = reader.u32()
  if (declaredFileSize !== data.length) throw new Error(`PRC decode error: declared file size ${declaredFileSize} does not match ${data.length}`)
  const uncompressedFileCount = reader.u32()
  const uncompressedFiles = new Array<Uint8Array>(uncompressedFileCount)
  for (let index = 0; index < uncompressedFileCount; index++) uncompressedFiles[index] = reader.take(reader.u32())
  const primitives: Pdf3DPrimitive[] = []
  const nodes: Pdf3DSceneNode[] = []
  const globals: PrcGlobals[] = new Array(structures.length)
  const tessellations: Pdf3DPrimitive[][][] = new Array(structures.length)
  const renderState: PrcRenderState = { lights: [], clippingPlanes: [] }
  for (let index = 0; index < structures.length; index++) {
    globals[index] = decodeGlobalsSection(data, structures[index]!, uncompressedFiles)
    tessellations[index] = decodeTessellationSection(data, structures[index]!, globals[index]!, primitives)
  }
  for (let index = 0; index < structures.length; index++) decodeTreeSection(data, structures[index]!, index, globals[index]!, tessellations[index]!, primitives, nodes, renderState)
  const unitsInMeters = decodeModelFile(data, modelFileOffset, structures.length)
  const bounds = calculatePdf3DSceneBounds({ nodes, primitives })
  return {
    format: 'PRC', minimalVersion, authoringVersion, unitsInMeters, nodes, primitives, bounds,
    ...(renderState.backgroundColor === undefined ? {} : { backgroundColor: renderState.backgroundColor }),
    ...(renderState.lights.length === 0 ? {} : { lights: renderState.lights }),
    ...(renderState.clippingPlanes.length === 0 ? {} : { clippingPlanes: renderState.clippingPlanes }),
  }
}

interface PrcRenderState {
  backgroundColor?: [number, number, number]
  lights: Pdf3DLightSource[]
  clippingPlanes: Pdf3DClippingPlane[]
}

function compressedSection(data: Uint8Array, start: number, end: number, label: string): PrcBitReader {
  if (start >= end || end > data.length) throw new Error(`PRC decode error: invalid ${label} section offsets`)
  return new PrcBitReader(zlibInflate(data.subarray(start, end)), `PRC ${label} section`)
}

function decodeModelFile(data: Uint8Array, offset: number, structureCount: number): number | null {
  if (offset === data.length) return null
  if (offset > data.length) throw new Error('PRC decode error: model file offset is outside the file')
  const reader = new PrcBitReader(zlibInflate(data.subarray(offset)), 'PRC model file')
  const schemaCount = reader.unsigned()
  if (schemaCount !== 0) throw new Error(`${reader.label}: schema extensions are not valid for the adopted PRC version`)
  if (reader.unsigned() !== 301) throw new Error(`${reader.label}: invalid model file entity`)
  reader.contentPrcBase()
  const unitsFromCad = reader.boolean()
  const unitsInMillimetres = reader.double()
  const rootCount = reader.unsigned()
  for (let index = 0; index < rootCount; index++) {
    for (let word = 0; word < 4; word++) reader.unsigned()
    reader.unsigned(); reader.boolean()
  }
  for (let index = 0; index < structureCount; index++) reader.unsigned()
  reader.userData()
  return unitsFromCad ? unitsInMillimetres * 0.001 : null
}

function decodeGlobalsSection(data: Uint8Array, structure: PrcFileStructureDescription, uncompressedFiles: Uint8Array[]): PrcGlobals {
  const reader = compressedSection(data, structure.offsets[1]!, structure.offsets[2]!, 'globals')
  const schemaCount = reader.unsigned()
  if (schemaCount !== 0) throw new Error(`${reader.label}: schema extensions are not valid for the adopted PRC version`)
  if (reader.unsigned() !== 303) throw new Error(`${reader.label}: invalid globals entity`)
  reader.contentPrcBase()
  const referencedCount = reader.unsigned()
  for (let index = 0; index < referencedCount; index++) for (let word = 0; word < 4; word++) reader.unsigned()
  reader.double(); reader.double()
  const defaultFont = reader.string() ?? 'Helvetica'
  const fontCount = reader.unsigned()
  const fonts: PrcFont[] = []
  for (let index = 0; index < fontCount; index++) {
    const family = reader.string() ?? defaultFont; reader.unsigned()
    const keyCount = reader.unsigned()
    for (let key = 0; key < keyCount; key++) fonts.push({ family, size: reader.unsigned() + 1, attributes: reader.character() })
  }
  const colorCount = reader.unsigned()
  const colors = new Array<[number, number, number]>(colorCount)
  for (let index = 0; index < colorCount; index++) colors[index] = [reader.double(), reader.double(), reader.double()]
  const pictureCount = reader.unsigned()
  const pictures = new Array<PrcPicture>(pictureCount)
  for (let index = 0; index < pictureCount; index++) pictures[index] = readPicture(reader, uncompressedFiles)
  const textureCount = reader.unsigned()
  const textures = new Array<PrcTextureDefinition>(textureCount)
  for (let index = 0; index < textureCount; index++) textures[index] = readTextureDefinition(reader, pictures)
  const materialCount = reader.unsigned()
  const materials = new Array<PrcMaterial>(materialCount)
  for (let index = 0; index < materialCount; index++) materials[index] = readMaterial(reader)
  const linePatternCount = reader.unsigned()
  for (let index = 0; index < linePatternCount; index++) readLinePattern(reader)
  const styleCount = reader.unsigned()
  const styleDefinitions = new Array<PrcStyle>(styleCount)
  for (let index = 0; index < styleCount; index++) styleDefinitions[index] = readStyle(reader)
  const fillPatternCount = reader.unsigned()
  for (let index = 0; index < fillPatternCount; index++) readFillPattern(reader)
  const coordinateCount = reader.unsigned()
  const coordinates = new Array<Pdf3DMatrix4>(coordinateCount)
  for (let index = 0; index < coordinateCount; index++) coordinates[index] = readCoordinateSystem(reader)
  reader.userData()
  const styles = styleDefinitions.map(function (style) { return resolveStyleColor(style, colors, materials) })
  return { fonts, colors, coordinates, styles, pictures, textures, materials, styleDefinitions }
}

interface PrcPicture { format: number; image: Pdf3DTextureImage }
interface PrcTextureDefinition {
  pictureIndex: number
  image: Pdf3DTextureImage
  dimensions: number
  mappingType: number
  mappingOperator: number
  mappingTransform: Pdf3DMatrix4
  mappingAttributes: number
  intensity: number
  components: number
  textureFunction: number
  blendColor: [number, number, number, number]
  application: number
  alphaTest: number
  alphaReference: number
  wrapS: number
  wrapT: number
  wrapR: number
  transform: Pdf3DMatrix4
  flipS: boolean
  flipT: boolean
}
interface PrcMaterial {
  colorIndex: number
  alpha: number
  genericMaterial: number
  textureDefinition: number
  nextTexture: number
  uvIndex: number
  ambientIndex: number
  emissiveIndex: number
  specularIndex: number
  shininess: number
  ambientAlpha: number
  emissiveAlpha: number
  specularAlpha: number
}
interface PrcStyle { material: boolean; colorMaterialIndex: number; alpha: number | null; renderingParameters: number }

function readPicture(reader: PrcBitReader, uncompressedFiles: Uint8Array[]): PrcPicture {
  if (reader.unsigned() !== 703) throw new Error(`${reader.label}: invalid picture entity`)
  reader.contentPrcBase()
  const format = reader.integer(), fileIndex = reader.unsigned() - 1, declaredWidth = reader.unsigned(), declaredHeight = reader.unsigned()
  const bytes = uncompressedFiles[fileIndex]
  if (bytes === undefined) throw new Error(`${reader.label}: picture uncompressed-file index is outside the file array`)
  let image: Pdf3DTextureImage
  if (format === 0) { const decoded = decodePng(bytes); image = { width: decoded.width, height: decoded.height, rgba: decoded.pixels } }
  else if (format === 1) { const decoded = decodeJpegToRgba(bytes); image = { width: decoded.width, height: decoded.height, rgba: decoded.rgba } }
  else if (format >= 2 && format <= 5) {
    if (declaredWidth === 0 || declaredHeight === 0) throw new Error(`${reader.label}: raw picture dimensions must be positive`)
    const raw = zlibInflate(bytes)
    const components = [3, 4, 1, 2][format - 2]!
    if (raw.length !== declaredWidth * declaredHeight * components) throw new Error(`${reader.label}: raw picture byte count does not match its dimensions`)
    const rgba = new Uint8Array(declaredWidth * declaredHeight * 4)
    for (let pixel = 0; pixel < declaredWidth * declaredHeight; pixel++) {
      const source = pixel * components, target = pixel * 4
      if (format === 2 || format === 3) { rgba[target] = raw[source]!; rgba[target + 1] = raw[source + 1]!; rgba[target + 2] = raw[source + 2]! }
      else rgba[target] = rgba[target + 1] = rgba[target + 2] = raw[source]!
      rgba[target + 3] = format === 3 ? raw[source + 3]! : format === 5 ? raw[source + 1]! : 255
    }
    image = { width: declaredWidth, height: declaredHeight, rgba }
  } else throw new Error(`${reader.label}: invalid picture format ${format}`)
  return { format, image }
}

function readTextureDefinition(reader: PrcBitReader, pictures: PrcPicture[]): PrcTextureDefinition {
  if (reader.unsigned() !== 712) throw new Error(`${reader.label}: invalid texture-definition entity`)
  reader.contentPrcBase(true)
  const pictureIndex = reader.unsigned() - 1
  const picture = pictures[pictureIndex]
  if (picture === undefined) throw new Error(`${reader.label}: texture picture index is outside the globals array`)
  const dimensions = reader.character()
  if (dimensions < 1 || dimensions > 3) throw new Error(`${reader.label}: texture dimension must be 1 through 3`)
  const mappingType = reader.integer()
  if (mappingType < 1 || mappingType > 4) throw new Error(`${reader.label}: invalid texture mapping type ${mappingType}`)
  let mappingOperator = 1, mappingTransform = identityMatrix()
  if (mappingType === 4) { mappingOperator = reader.integer(); if (mappingOperator < 1 || mappingOperator > 5) throw new Error(`${reader.label}: invalid texture mapping operator ${mappingOperator}`); if (reader.boolean()) mappingTransform = readCartesianTransformation(reader) }
  const mappingAttributes = reader.unsigned()
  const intensityCount = reader.unsigned(); if (intensityCount > 1) throw new Error(`${reader.label}: multiple texture intensities are reserved`); let intensity = 1
  for (let index = 0; index < intensityCount; index++) { const value = reader.double(); if (index === 0) intensity = value }
  const componentCount = reader.unsigned(); if (componentCount > 1) throw new Error(`${reader.label}: multiple texture component masks are reserved`); let components = 0x0F
  for (let index = 0; index < componentCount; index++) { const value = reader.character(); if (index === 0) components = value }
  const textureFunction = reader.integer()
  if (textureFunction < 1 || textureFunction > 5) throw new Error(`${reader.label}: invalid texture function ${textureFunction}`)
  const blendColor: [number, number, number, number] = [1, 1, 1, 1]
  if (textureFunction === 4) for (let component = 0; component < 4; component++) blendColor[component] = reader.double()
  if (reader.integer() !== 1) reader.integer()
  if (reader.integer() !== 1) reader.integer()
  const application = reader.character()
  if ((application & ~7) !== 0) throw new Error(`${reader.label}: invalid texture application mode`)
  let alphaTest = 1, alphaReference = 0
  if ((application & 2) !== 0) { alphaTest = reader.integer(); alphaReference = reader.double() }
  const wrapS = reader.integer(), wrapT = dimensions > 1 ? reader.integer() : 1, wrapR = dimensions > 2 ? reader.integer() : 1
  if (wrapS < 1 || wrapS > 6 || wrapT < 1 || wrapT > 6 || wrapR < 1 || wrapR > 6) throw new Error(`${reader.label}: invalid texture wrapping mode`)
  let transform = identityMatrix(), flipS = false, flipT = false
  if (reader.boolean()) {
    if (reader.unsigned() !== 713) throw new Error(`${reader.label}: invalid texture-transformation entity`)
    flipS = reader.boolean(); flipT = reader.boolean(); reader.boolean(); transform = readTransformationEntity(reader)
  }
  return { pictureIndex, image: picture.image, dimensions, mappingType, mappingOperator, mappingTransform, mappingAttributes, intensity, components, textureFunction, blendColor, application, alphaTest, alphaReference, wrapS, wrapT, wrapR, transform, flipS, flipT }
}

function readMaterial(reader: PrcBitReader): PrcMaterial {
  const type = reader.unsigned()
  if (type === 711) {
    reader.contentPrcBase(true)
    const genericMaterial = reader.unsigned() - 1
    const textureDefinition = reader.unsigned() - 1, nextTexture = reader.unsigned() - 1, uvIndex = reader.unsigned() - 1
    return { colorIndex: -1, alpha: 1, genericMaterial, textureDefinition, nextTexture, uvIndex, ambientIndex: -1, emissiveIndex: -1, specularIndex: -1, shininess: 0, ambientAlpha: 1, emissiveAlpha: 1, specularAlpha: 1 }
  }
  if (type !== 702) throw new Error(`${reader.label}: invalid material entity ${type}`)
  reader.contentPrcBase(true)
  const ambientIndex = reader.unsigned() - 1
  const colorIndex = reader.unsigned() - 1
  const emissiveIndex = reader.unsigned() - 1, specularIndex = reader.unsigned() - 1
  const shininess = reader.double(), ambientAlpha = reader.double()
  const alpha = reader.double()
  const emissiveAlpha = reader.double(), specularAlpha = reader.double()
  return { colorIndex, alpha, genericMaterial: -1, textureDefinition: -1, nextTexture: -1, uvIndex: -1, ambientIndex, emissiveIndex, specularIndex, shininess, ambientAlpha, emissiveAlpha, specularAlpha }
}

function resolveStyleColor(style: PrcStyle, colors: Array<[number, number, number]>, materials: PrcMaterial[]): [number, number, number, number] | null {
  let colorIndex = style.colorMaterialIndex
  let alpha = 1
  if (style.material) {
    const visited = new Set<number>()
    let material = materials[colorIndex]
    while (material !== undefined && material.genericMaterial >= 0) {
      if (visited.has(colorIndex)) throw new Error('PRC decode error: recursive texture material chain')
      visited.add(colorIndex); colorIndex = material.genericMaterial; material = materials[colorIndex]
    }
    if (material === undefined) throw new Error('PRC decode error: style material index is outside the globals array')
    colorIndex = material.colorIndex; alpha = material.alpha
  }
  const color = colors[colorIndex]
  if (color === undefined) return null
  if (style.alpha !== null) alpha = style.alpha
  return [color[0], color[1], color[2], alpha]
}

function resolvePrcRenderPasses(styleIndex: number, globals: PrcGlobals): Pdf3DRenderPass[] {
  const style = globals.styleDefinitions[styleIndex]
  if (style === undefined || !style.material) return []
  let materialIndex = style.colorMaterialIndex
  const layers: Pdf3DTextureLayer[] = []
  const visited = new Set<number>()
  let generic: PrcMaterial | undefined
  let lighting = false, alphaCompare = 0x0617, alphaReference = 0
  while (materialIndex >= 0) {
    if (visited.has(materialIndex)) throw new Error('PRC decode error: recursive texture material chain')
    visited.add(materialIndex)
    const material = globals.materials[materialIndex]
    if (material === undefined) throw new Error('PRC decode error: style material index is outside the globals array')
    if (material.genericMaterial < 0) { generic = material; break }
    if (generic === undefined) generic = globals.materials[material.genericMaterial]
    const texture = globals.textures[material.textureDefinition]
    if (texture === undefined) throw new Error('PRC decode error: texture-application definition index is outside the globals array')
    const textureMode = texture.mappingType === 4 ? texture.mappingOperator === 3 ? 2 : texture.mappingOperator === 4 ? 3 : 1 : 0
    let transform = texture.transform
    if (texture.flipS || texture.flipT) {
      const flip = identityMatrix()
      if (texture.flipS) { flip[0] = -1; flip[12] = 1 }
      if (texture.flipT) { flip[5] = -1; flip[13] = 1 }
      transform = multiplyMatrices(transform, flip)
    }
    const blendFunction = texture.textureFunction === 3 ? 2 : texture.textureFunction === 4 || texture.textureFunction === 5 ? 3 : 0
    layers.push({
      channel: Math.max(0, material.uvIndex), textureName: `PRC picture ${texture.pictureIndex}`, image: texture.image,
      intensity: texture.intensity, blendFunction: blendFunction as 0 | 1 | 2 | 3, blendSource: 0,
      blendConstant: texture.blendColor[3], textureMode: textureMode as 0 | 1 | 2 | 3 | 4,
      textureTransform: transform, wrapTransform: texture.mappingTransform,
      repeat: (texture.wrapS === 2 ? 1 : 0) | (texture.wrapT === 2 ? 2 : 0),
      componentMask: texture.mappingAttributes === 0 ? texture.components : texture.mappingAttributes & texture.components, blendColor: texture.blendColor,
      prcTextureFunction: (texture.textureFunction === 1 ? 2 : texture.textureFunction) as 2 | 3 | 4 | 5,
      wrapModes: [texture.wrapS, texture.wrapT],
    })
    lighting = lighting || (texture.application & 1) !== 0
    if ((texture.application & 2) !== 0) { alphaCompare = prcAlphaCompare(texture.alphaTest); alphaReference = texture.alphaReference }
    materialIndex = material.nextTexture
  }
  if (generic === undefined || generic.genericMaterial >= 0) return []
  const surface = prcSurface(style, generic, globals.colors, lighting)
  return [{ material: surface, alphaReference, alphaCompare, frameBufferBlend: 0x0608, alphaTextureChannels: 0xFF, layers }]
}

function resolvePrcSurface(styleIndex: number, globals: PrcGlobals): Pdf3DSurfaceMaterial | undefined {
  const style = globals.styleDefinitions[styleIndex]
  if (style === undefined || !style.material) return undefined
  let materialIndex = style.colorMaterialIndex
  const visited = new Set<number>()
  while (materialIndex >= 0) {
    if (visited.has(materialIndex)) throw new Error('PRC decode error: recursive texture material chain')
    visited.add(materialIndex)
    const material = globals.materials[materialIndex]
    if (material === undefined) throw new Error('PRC decode error: style material index is outside the globals array')
    if (material.genericMaterial < 0) return prcSurface(style, material, globals.colors, true)
    materialIndex = material.genericMaterial
  }
  throw new Error('PRC decode error: material style does not resolve to a generic material')
}

function prcSurface(style: PrcStyle, material: PrcMaterial, colors: Array<[number, number, number]>, useLighting: boolean): Pdf3DSurfaceMaterial {
  const color = function (index: number): Pdf3DVector3 { return colors[index] ?? [0, 0, 0] }
  return {
    lighting: useLighting && (style.renderingParameters & 8) === 0,
    ambient: color(material.ambientIndex), diffuse: color(material.colorIndex),
    emissive: color(material.emissiveIndex), specular: color(material.specularIndex),
    reflectivity: Math.max(0, Math.min(1, material.shininess / 128)), opacity: style.alpha ?? material.alpha,
  }
}

function prcAlphaCompare(value: number): number {
  if (value <= 1) return 0x0617
  if (value >= 2 && value <= 9) return 0x060E + value
  throw new Error(`PRC decode error: invalid texture alpha-test function ${value}`)
}

function readLinePattern(reader: PrcBitReader): void {
  if (reader.unsigned() !== 721) throw new Error(`${reader.label}: invalid line pattern entity`)
  reader.contentPrcBase(true)
  const count = reader.unsigned()
  for (let index = 0; index < count; index++) reader.double()
  reader.double(); reader.boolean()
}

function readStyle(reader: PrcBitReader): PrcStyle {
  if (reader.unsigned() !== 701) throw new Error(`${reader.label}: invalid style entity`)
  reader.contentPrcBase(true)
  reader.double(); reader.boolean(); reader.unsigned()
  const material = reader.boolean()
  const colorMaterialIndex = reader.unsigned() - 1
  const alpha = reader.boolean() ? reader.character() / 255 : null
  const renderingParameters = reader.boolean() ? reader.character() : 0
  reader.boolean(); reader.boolean()
  return { material, colorMaterialIndex, alpha, renderingParameters }
}

function readFillPattern(reader: PrcBitReader): void {
  const type = reader.unsigned()
  if (type < 723 || type > 726) throw new Error(`${reader.label}: invalid fill-pattern entity ${type}`)
  reader.contentPrcBase(true); reader.unsigned()
  if (type === 723) { reader.double(); reader.boolean(); reader.integer(); return }
  if (type === 724) {
    const count = reader.unsigned()
    for (let line = 0; line < count; line++) { for (let value = 0; value < 5; value++) reader.double(); reader.integer() }
    return
  }
  if (type === 725) { reader.boolean(); reader.unsigned(); return }
  reader.double(); reader.double(); readMarkupTessellation(reader, -1)
}

function readCoordinateSystem(reader: PrcBitReader): Pdf3DMatrix4 {
  if (reader.unsigned() !== 240) throw new Error(`${reader.label}: invalid coordinate-system entity`)
  reader.contentPrcBase(true); reader.graphics(); reader.unsigned(); reader.unsigned()
  const matrix = readTransformationEntity(reader)
  reader.userData()
  return matrix
}

interface PrcRepresentationItem {
  name: string
  uniqueId: number
  graphics: PrcGraphics
  localCoordinate: number
  tessellation: number
  points?: Pdf3DVector3[]
  children?: PrcRepresentationItem[]
}

interface PrcView {
  name: string
  defaultView: boolean
  camera: PrcCamera | null
  parameters: PrcSceneParameters | null
  filters: PrcFilter[]
}

interface PrcSceneParameters {
  active: boolean
  camera: PrcCamera | null
  backgroundStyle: number
  lights: PrcLight[]
  clippingPlanes: Pdf3DMatrix4[]
  absolute: boolean
}

interface PrcLight {
  name: string
  type: 'ambient' | 'point' | 'directional' | 'spot'
  ambientIndex: number
  diffuseIndex: number
  emissiveIndex: number
  specularIndex: number
  location: Pdf3DVector3
  direction: Pdf3DVector3
  attenuation: Pdf3DVector3
  intensity: number
  spotAngle: number
  spotExponent: number
}

interface PrcCamera {
  orthographic: boolean
  position: Pdf3DVector3
  look: Pdf3DVector3
  up: Pdf3DVector3
  fieldX: number
  fieldY: number
  nearClip: number
  farClip: number
  zoom: number
}

interface PrcMarkupElement {
  name: string
  uniqueId: number
  graphics: PrcGraphics
  tessellation: number
}

interface PrcMarkupData {
  elements: PrcMarkupElement[]
}

interface PrcPartDefinition { items: PrcRepresentationItem[]; markups: PrcMarkupData; views: PrcView[] }

interface PrcEntityReference {
  targetType: number
  targetUniqueId: number
  graphics: PrcGraphics
  localCoordinate: number
}

interface PrcFilter {
  active: boolean
  layerInclusive: boolean
  layers: Set<number>
  entityInclusive: boolean
  entityUniqueIds: Set<number>
}

interface PrcProductOccurrence {
  name: string
  graphics: PrcGraphics
  part: number
  children: number[]
  location: Pdf3DMatrix4
  suppressed: boolean
  references: PrcEntityReference[]
  markups: PrcMarkupData
  entityFilter: PrcFilter | null
  displayFilters: PrcFilter[]
  views: PrcView[]
  sceneParameters: PrcSceneParameters[]
}

function decodeTreeSection(
  data: Uint8Array,
  structure: PrcFileStructureDescription,
  structureIndex: number,
  globals: PrcGlobals,
  tessellations: Pdf3DPrimitive[][],
  primitives: Pdf3DPrimitive[],
  nodes: Pdf3DSceneNode[],
  renderState: PrcRenderState,
): void {
  const reader = compressedSection(data, structure.offsets[2]!, structure.offsets[3]!, 'tree')
  if (reader.unsigned() !== 304) throw new Error(`${reader.label}: invalid tree entity`)
  reader.contentPrcBase()
  const partCount = reader.unsigned()
  const parts = new Array<PrcPartDefinition>(partCount)
  for (let index = 0; index < partCount; index++) parts[index] = readPartDefinition(reader)
  const occurrenceCount = reader.unsigned()
  const occurrences = new Array<PrcProductOccurrence>(occurrenceCount)
  for (let index = 0; index < occurrenceCount; index++) occurrences[index] = readProductOccurrence(reader)
  if (reader.unsigned() !== 302) throw new Error(`${reader.label}: invalid FileStructure entity`)
  reader.contentPrcBase(); reader.unsigned()
  const rootEncoded = reader.unsigned()
  reader.userData()
  if (occurrenceCount === 0) {
    for (let part = 0; part < parts.length; part++) {
      appendPrcViews(parts[part]!.views, `PRC ${structureIndex} part ${part}`, identityMatrix(), structureIndex, globals, nodes, renderState)
      appendPartNodes(parts[part]!.items, `PRC ${structureIndex} part ${part}`, globals, tessellations, structureIndex, primitives, nodes, [], [])
      appendMarkupNodes(parts[part]!.markups, `PRC ${structureIndex} part ${part}`, globals, tessellations, structureIndex, nodes)
    }
    return
  }
  const root = rootEncoded === 0 ? occurrenceCount - 1 : rootEncoded - 1
  if (root < 0 || root >= occurrences.length) throw new Error(`${reader.label}: root product occurrence is outside the occurrence array`)
  appendOccurrenceNodes(root, '', identityMatrix(), occurrences, parts, globals, tessellations, structureIndex, primitives, nodes, new Set<number>(), renderState)
}

function readPartDefinition(reader: PrcBitReader): PrcPartDefinition {
  if (reader.unsigned() !== 311) throw new Error(`${reader.label}: invalid PartDefinition entity`)
  reader.contentPrcBase(true); reader.graphics()
  for (let value = 0; value < 6; value++) reader.double()
  const count = reader.unsigned()
  const items = new Array<PrcRepresentationItem>(count)
  for (let index = 0; index < count; index++) items[index] = readRepresentationItem(reader)
  const markups = readMarkupData(reader)
  const viewCount = reader.unsigned()
  const views = new Array<PrcView>(viewCount)
  for (let index = 0; index < viewCount; index++) views[index] = readPrcView(reader)
  reader.userData()
  return { items, markups, views }
}

function readRepresentationItem(reader: PrcBitReader): PrcRepresentationItem {
  const type = reader.unsigned()
  if (type < 232 || type > 240) throw new Error(`${reader.label}: invalid representation-item entity ${type}`)
  const base = reader.contentPrcBaseDetails(true)
  const name = base.name
  const graphics = reader.graphics()
  const localCoordinate = reader.unsigned() - 1
  const tessellation = reader.unsigned() - 1
  const result: PrcRepresentationItem = { name, uniqueId: base.uniqueId, graphics, localCoordinate, tessellation }
  if (type === 232) {
    if (reader.boolean()) { reader.unsigned(); reader.unsigned() }
    reader.boolean()
  } else if (type === 233) {
    if (reader.boolean()) { reader.unsigned(); reader.unsigned() }
  } else if (type === 234) {
    if (reader.boolean()) { reader.double(); reader.double(); reader.double() }
    reader.double(); reader.double(); reader.double()
  } else if (type === 235) {
    if (reader.boolean()) { reader.unsigned(); reader.unsigned() }
  } else if (type === 236) {
    const count = reader.unsigned()
    result.points = new Array<Pdf3DVector3>(count)
    for (let index = 0; index < count; index++) result.points[index] = [reader.double(), reader.double(), reader.double()]
  } else if (type === 237) reader.boolean()
  else if (type === 239) {
    const count = reader.unsigned()
    result.children = new Array<PrcRepresentationItem>(count)
    for (let index = 0; index < count; index++) result.children[index] = readRepresentationItem(reader)
  } else if (type === 240) readTransformationEntity(reader)
  reader.userData()
  return result
}

function readProductOccurrence(reader: PrcBitReader): PrcProductOccurrence {
  if (reader.unsigned() !== 310) throw new Error(`${reader.label}: invalid ProductOccurrence entity`)
  const name = reader.contentPrcBase(true)
  const graphics = reader.graphics()
  const part = reader.unsigned() - 1
  const prototype = reader.unsigned() - 1
  if (prototype >= 0) readFileIdentifier(reader)
  const external = reader.unsigned() - 1
  if (external >= 0) readFileIdentifier(reader)
  const childCount = reader.unsigned()
  const children = new Array<number>(childCount)
  for (let index = 0; index < childCount; index++) children[index] = reader.unsigned()
  const behavior = reader.character()
  reader.boolean(); reader.double(); reader.character(); reader.integer()
  const location = reader.boolean() ? readCartesianTransformation(reader) : identityMatrix()
  const referenceCount = reader.unsigned()
  const references = new Array<PrcEntityReference>(referenceCount)
  for (let index = 0; index < referenceCount; index++) references[index] = readEntityReference(reader)
  const markups = readMarkupData(reader)
  const viewCount = reader.unsigned()
  const views = new Array<PrcView>(viewCount)
  for (let index = 0; index < viewCount; index++) views[index] = readPrcView(reader)
  const entityFilter = reader.boolean() ? readFilter(reader) : null
  const displayFilterCount = reader.unsigned()
  const displayFilters = new Array<PrcFilter>(displayFilterCount)
  for (let index = 0; index < displayFilterCount; index++) displayFilters[index] = readFilter(reader)
  const sceneParameterCount = reader.unsigned()
  const sceneParameters: PrcSceneParameters[] = []
  for (let index = 0; index < sceneParameterCount; index++) {
    const parameters = readSceneDisplayParameters(reader)
    if (parameters.active) sceneParameters.push(parameters)
  }
  reader.userData()
  return {
    name, graphics, part, children, location, references, markups, entityFilter, displayFilters, views, sceneParameters,
    suppressed: (behavior & 1) !== 0 || (graphics.behavior & 0x2001) !== 1,
  }
}

function readEntityReference(reader: PrcBitReader): PrcEntityReference {
  if (reader.unsigned() !== 203) throw new Error(`${reader.label}: invalid entity-reference entity`)
  reader.contentPrcBase(true)
  const graphics = reader.graphics()
  const localCoordinate = reader.unsigned() - 1
  let targetType = -1, targetUniqueId = -1
  if (reader.boolean()) {
    const referenceType = reader.unsigned()
    if (referenceType === 205) {
      targetType = reader.unsigned()
      if (!reader.boolean()) for (let word = 0; word < 4; word++) reader.unsigned()
      targetUniqueId = reader.unsigned()
    } else if (referenceType === 206) {
      targetType = reader.unsigned()
      if (reader.boolean()) {
        if (!reader.boolean()) for (let word = 0; word < 4; word++) reader.unsigned()
        reader.unsigned(); reader.unsigned()
        const additionalCount = reader.unsigned()
        for (let index = 0; index < additionalCount; index++) reader.unsigned()
      }
    } else throw new Error(`${reader.label}: invalid entity-reference target ${referenceType}`)
  }
  reader.userData()
  return { targetType, targetUniqueId, graphics, localCoordinate }
}

function readFilter(reader: PrcBitReader): PrcFilter {
  if (reader.unsigned() !== 320) throw new Error(`${reader.label}: invalid assembly-filter entity`)
  reader.contentPrcBase(true)
  const active = reader.boolean()
  const layerInclusive = reader.boolean()
  const layerCount = reader.unsigned()
  const layers = new Set<number>()
  for (let index = 0; index < layerCount; index++) layers.add(reader.unsigned())
  const entityInclusive = reader.boolean()
  const entityCount = reader.unsigned()
  const entityUniqueIds = new Set<number>()
  for (let index = 0; index < entityCount; index++) {
    const reference = readEntityReference(reader)
    if (reference.targetUniqueId >= 0) entityUniqueIds.add(reference.targetUniqueId)
  }
  reader.userData()
  return { active, layerInclusive, layers, entityInclusive, entityUniqueIds }
}

function readPrcView(reader: PrcBitReader): PrcView {
  if (reader.unsigned() !== 501) throw new Error(`${reader.label}: invalid markup-view entity`)
  const name = reader.contentPrcBase(true)
  reader.graphics()
  const annotationCount = reader.unsigned()
  for (let index = 0; index < annotationCount; index++) readReferenceUniqueIdentifier(reader)
  readPrcPlane(reader)
  const parameters = reader.boolean() ? readSceneDisplayParameters(reader) : null
  reader.boolean()
  const defaultView = reader.boolean()
  reader.boolean()
  const linkedCount = reader.unsigned()
  for (let index = 0; index < linkedCount; index++) readReferenceUniqueIdentifier(reader)
  const filterCount = reader.unsigned()
  const filters = new Array<PrcFilter>(filterCount)
  for (let index = 0; index < filterCount; index++) filters[index] = readFilter(reader)
  reader.userData()
  return { name, defaultView, camera: parameters?.camera ?? null, parameters, filters }
}

function readReferenceUniqueIdentifier(reader: PrcBitReader): { type: number; uniqueId: number } {
  if (reader.unsigned() !== 205) throw new Error(`${reader.label}: invalid reference-unique-identifier entity`)
  const type = reader.unsigned()
  if (!reader.boolean()) for (let word = 0; word < 4; word++) reader.unsigned()
  return { type, uniqueId: reader.unsigned() }
}

function readSceneDisplayParameters(reader: PrcBitReader): PrcSceneParameters {
  if (reader.unsigned() !== 741) throw new Error(`${reader.label}: invalid scene-display-parameters entity`)
  reader.contentPrcBase(true)
  const active = reader.boolean()
  const lightCount = reader.unsigned()
  const lights = new Array<PrcLight>(lightCount)
  for (let index = 0; index < lightCount; index++) lights[index] = readPrcLight(reader)
  const camera = reader.boolean() ? readPrcCamera(reader) : null
  if (reader.boolean()) { reader.double(); reader.double(); reader.double() }
  const clippingCount = reader.unsigned()
  const clippingPlanes = new Array<Pdf3DMatrix4>(clippingCount)
  for (let index = 0; index < clippingCount; index++) clippingPlanes[index] = readPrcPlane(reader)
  const backgroundStyle = reader.unsigned() - 1
  reader.unsigned()
  const styleCount = reader.unsigned()
  for (let index = 0; index < styleCount; index++) { reader.unsigned(); reader.unsigned() }
  const absolute = reader.boolean()
  return { active, camera, backgroundStyle, lights, clippingPlanes, absolute }
}

function readPrcCamera(reader: PrcBitReader): PrcCamera {
  if (reader.unsigned() !== 742) throw new Error(`${reader.label}: invalid camera entity`)
  reader.contentPrcBase(true)
  const orthographic = reader.boolean()
  const position: Pdf3DVector3 = [reader.double(), reader.double(), reader.double()]
  const look: Pdf3DVector3 = [reader.double(), reader.double(), reader.double()]
  const up: Pdf3DVector3 = [reader.double(), reader.double(), reader.double()]
  const fieldX = reader.double(), fieldY = reader.double()
  reader.double()
  const nearClip = reader.double(), farClip = reader.double(), zoom = reader.double()
  if (nearClip < 0 || farClip <= nearClip || zoom <= 0) throw new Error(`${reader.label}: invalid PRC camera clipping or zoom`)
  return { orthographic, position, look, up, fieldX, fieldY, nearClip, farClip, zoom }
}

function readPrcLight(reader: PrcBitReader): PrcLight {
  const type = reader.unsigned()
  if (type < 731 || type > 734) throw new Error(`${reader.label}: invalid PRC light entity ${type}`)
  const name = reader.contentPrcBase(true)
  const ambientIndex = reader.unsigned() - 1
  const diffuseIndex = reader.unsigned() - 1
  const emissiveIndex = reader.unsigned() - 1
  const specularIndex = reader.unsigned() - 1
  const result: PrcLight = {
    name, type: (['ambient', 'point', 'directional', 'spot'] as const)[type - 731]!,
    ambientIndex, diffuseIndex, emissiveIndex, specularIndex,
    location: [0, 0, 0], direction: [0, 0, -1], attenuation: [1, 0, 0], intensity: 1,
    spotAngle: 180, spotExponent: 0,
  }
  if (type === 731) return result
  if (type === 732 || type === 734) {
    result.location = [reader.double(), reader.double(), reader.double()]
    result.attenuation = [reader.double(), reader.double(), reader.double()]
    if (type === 732) return result
    result.direction = [reader.double(), reader.double(), reader.double()]
    result.spotAngle = reader.double(); result.spotExponent = reader.double()
    return result
  }
  result.direction = [reader.double(), reader.double(), reader.double()]
  result.intensity = reader.double()
  return result
}

function readPrcPlane(reader: PrcBitReader): Pdf3DMatrix4 {
  if (reader.unsigned() !== 86) throw new Error(`${reader.label}: invalid plane entity`)
  reader.baseGeometry(); reader.unsigned()
  const transform = readTransformationEntity(reader)
  for (let value = 0; value < 8; value++) reader.double()
  return transform
}

function readFileIdentifier(reader: PrcBitReader): void {
  if (!reader.boolean()) for (let word = 0; word < 4; word++) reader.unsigned()
}

function readMarkupData(reader: PrcBitReader): PrcMarkupData {
  const linkedItemCount = reader.unsigned()
  for (let index = 0; index < linkedItemCount; index++) readMarkupLinkedItem(reader)
  const elements: PrcMarkupElement[] = []
  const leaderCount = reader.unsigned()
  for (let index = 0; index < leaderCount; index++) elements.push(readMarkupLeader(reader))
  const markupCount = reader.unsigned()
  for (let index = 0; index < markupCount; index++) elements.push(readMarkupElement(reader))
  const annotationCount = reader.unsigned()
  for (let index = 0; index < annotationCount; index++) readAnnotationEntity(reader)
  return { elements }
}

function readMarkupLinkedItem(reader: PrcBitReader): void {
  if (reader.unsigned() !== 204) throw new Error(`${reader.label}: invalid markup-linked-item entity`)
  readContentEntityReference(reader)
  readReferenceData(reader)
  for (let flag = 0; flag < 4; flag++) reader.boolean()
  reader.userData()
}

function readContentEntityReference(reader: PrcBitReader): void {
  reader.contentPrcBase(true)
  reader.graphics()
  reader.unsigned()
  if (reader.boolean()) readReferenceData(reader)
}

function readReferenceData(reader: PrcBitReader): void {
  const type = reader.unsigned()
  if (type === 205) {
    reader.unsigned()
    if (!reader.boolean()) for (let word = 0; word < 4; word++) reader.unsigned()
    reader.unsigned()
    return
  }
  if (type === 206) {
    reader.unsigned()
    if (reader.boolean()) {
      if (!reader.boolean()) for (let word = 0; word < 4; word++) reader.unsigned()
      reader.unsigned(); reader.unsigned()
      const additionalCount = reader.unsigned()
      for (let index = 0; index < additionalCount; index++) reader.unsigned()
    }
    return
  }
  throw new Error(`${reader.label}: invalid markup reference target ${type}`)
}

function readMarkupLeader(reader: PrcBitReader): PrcMarkupElement {
  if (reader.unsigned() !== 503) throw new Error(`${reader.label}: invalid markup-leader entity`)
  const base = reader.contentPrcBaseDetails(true)
  const graphics = reader.graphics()
  readReferenceUniqueIdentifierArray(reader)
  readReferenceUniqueIdentifierArray(reader)
  const tessellation = reader.unsigned() - 1
  reader.userData()
  return { name: base.name, uniqueId: base.uniqueId, graphics, tessellation }
}

function readMarkupElement(reader: PrcBitReader): PrcMarkupElement {
  if (reader.unsigned() !== 502) throw new Error(`${reader.label}: invalid markup entity`)
  const base = reader.contentPrcBaseDetails(true)
  const graphics = reader.graphics()
  reader.unsigned(); reader.unsigned()
  readReferenceUniqueIdentifierArray(reader)
  readReferenceUniqueIdentifierArray(reader)
  const tessellation = reader.unsigned() - 1
  reader.userData()
  return { name: base.name, uniqueId: base.uniqueId, graphics, tessellation }
}

function readReferenceUniqueIdentifierArray(reader: PrcBitReader): void {
  const count = reader.unsigned()
  for (let index = 0; index < count; index++) readReferenceUniqueIdentifier(reader)
}

function readAnnotationEntity(reader: PrcBitReader): void {
  const type = reader.unsigned()
  if (type < 504 || type > 506) throw new Error(`${reader.label}: invalid annotation entity ${type}`)
  reader.contentPrcBase(true)
  reader.graphics()
  if (type === 504) readReferenceUniqueIdentifier(reader)
  else if (type === 505) {
    const count = reader.unsigned()
    for (let index = 0; index < count; index++) readAnnotationEntity(reader)
  } else readReferenceUniqueIdentifierArray(reader)
  reader.userData()
}

function appendOccurrenceNodes(
  index: number,
  parentName: string,
  parentWorld: Pdf3DMatrix4,
  occurrences: PrcProductOccurrence[],
  parts: PrcPartDefinition[],
  globals: PrcGlobals,
  tessellations: Pdf3DPrimitive[][],
  structureIndex: number,
  primitives: Pdf3DPrimitive[],
  nodes: Pdf3DSceneNode[],
  active: Set<number>,
  renderState: PrcRenderState,
): void {
  if (active.has(index)) throw new Error('PRC decode error: recursive product occurrence hierarchy')
  const occurrence = occurrences[index]
  if (occurrence === undefined) throw new Error('PRC decode error: product occurrence child index is outside the array')
  active.add(index)
  const name = `PRC ${structureIndex} occurrence ${index}${occurrence.name === '' ? '' : ` ${occurrence.name}`}`
  const world = multiplyMatrices(parentWorld, occurrence.location)
  nodes.push({ kind: 'group', name, parents: [{ name: parentName, matrix: occurrence.location }], sourceBlockOffset: 0 })
  applyPrcSceneParameters(occurrence.sceneParameters, name, world, structureIndex, globals, nodes, renderState)
  appendPrcViews(occurrence.views, name, world, structureIndex, globals, nodes, renderState)
  appendMarkupNodes(occurrence.markups, name, globals, tessellations, structureIndex, nodes)
  if (!occurrence.suppressed && occurrence.part >= 0) {
    const part = parts[occurrence.part]
    if (part === undefined) throw new Error('PRC decode error: product occurrence part index is outside the array')
    const activeDisplay = occurrence.displayFilters.find(function (filter) { return filter.active })
    const defaultView = occurrence.views.find(function (view) { return view.defaultView })
    const activeViewFilter = defaultView?.filters.find(function (filter) { return filter.active })
    const filters = [occurrence.entityFilter, activeDisplay, activeViewFilter].filter(function (filter): filter is PrcFilter { return filter !== null && filter !== undefined })
    appendPrcViews(part.views, name, world, structureIndex, globals, nodes, renderState)
    appendPartNodes(part.items, name, globals, tessellations, structureIndex, primitives, nodes, filters, occurrence.references)
    appendMarkupNodes(part.markups, name, globals, tessellations, structureIndex, nodes)
  }
  for (let child = 0; child < occurrence.children.length; child++) appendOccurrenceNodes(occurrence.children[child]!, name, world, occurrences, parts, globals, tessellations, structureIndex, primitives, nodes, active, renderState)
  active.delete(index)
}

function appendMarkupNodes(
  markups: PrcMarkupData,
  parentName: string,
  globals: PrcGlobals,
  tessellations: Pdf3DPrimitive[][],
  structureIndex: number,
  nodes: Pdf3DSceneNode[],
): void {
  for (let index = 0; index < markups.elements.length; index++) {
    const markup = markups.elements[index]!
    if (markup.tessellation < 0 || (markup.graphics.behavior & 0x2001) !== 1) continue
    const group = tessellations[markup.tessellation]
    if (group === undefined) throw new Error('PRC decode error: markup tessellation index is outside the array')
    const color = markup.graphics.style < 0 ? null : globals.styles[markup.graphics.style]
    if (markup.graphics.style >= 0 && color === undefined) throw new Error('PRC decode error: markup style index is outside the globals array')
    for (let primitive = 0; primitive < group.length; primitive++) {
      nodes.push({
        kind: 'model', name: `PRC ${structureIndex} markup ${nodes.length}${markup.name === '' ? '' : ` ${markup.name}`}`,
        parents: [{ name: parentName, matrix: identityMatrix() }], resourceName: group[primitive]!.name,
        visibility: 3, sourceBlockOffset: 0, ...(color === null ? {} : { color }),
      })
    }
  }
}

function appendPrcViews(
  views: PrcView[],
  parentName: string,
  world: Pdf3DMatrix4,
  structureIndex: number,
  globals: PrcGlobals,
  nodes: Pdf3DSceneNode[],
  renderState: PrcRenderState,
): void {
  const ordered = [...views].sort(function (a, b) { return Number(b.defaultView) - Number(a.defaultView) })
  for (let index = 0; index < ordered.length; index++) {
    const view = ordered[index]!
    if (view.camera !== null) nodes.push(prcCameraNode(view.camera, `PRC ${structureIndex} view ${nodes.length}${view.name === '' ? '' : ` ${view.name}`}`, parentName))
    if (view.defaultView && view.parameters?.active === true) applyPrcSceneParameters([view.parameters], parentName, world, structureIndex, globals, nodes, renderState)
  }
}

function applyPrcSceneParameters(
  parameters: PrcSceneParameters[],
  parentName: string,
  world: Pdf3DMatrix4,
  structureIndex: number,
  globals: PrcGlobals,
  nodes: Pdf3DSceneNode[],
  renderState: PrcRenderState,
): void {
  for (let index = 0; index < parameters.length; index++) {
    const state = parameters[index]!
    const camera = state.camera
    if (camera !== null) nodes.push(prcCameraNode(camera, `PRC ${structureIndex} scene camera ${nodes.length}`, state.absolute ? '' : parentName))
    if (renderState.backgroundColor === undefined && state.backgroundStyle >= 0) {
      const color = globals.styles[state.backgroundStyle]
      if (color === undefined || color === null) throw new Error('PRC decode error: scene background style does not resolve to a color')
      renderState.backgroundColor = [color[0], color[1], color[2]]
    }
    appendPrcLights(state, world, structureIndex, globals, nodes, renderState)
    appendPrcClippingPlanes(state, world, renderState)
  }
}

function appendPrcLights(
  parameters: PrcSceneParameters,
  world: Pdf3DMatrix4,
  structureIndex: number,
  globals: PrcGlobals,
  nodes: Pdf3DSceneNode[],
  renderState: PrcRenderState,
): void {
  for (let index = 0; index < parameters.lights.length; index++) {
    const source = parameters.lights[index]!
    const local = prcLightMatrix(source)
    const matrix = parameters.absolute ? local : multiplyMatrices(world, local)
    const nodeName = `PRC ${structureIndex} light ${nodes.length}${source.name === '' ? '' : ` ${source.name}`}`
    nodes.push({ kind: 'light', name: nodeName, parents: [{ name: '', matrix }], resourceName: nodeName, sourceBlockOffset: 0 })
    const ambient = prcLightColor(source.ambientIndex, globals.colors)
    const diffuse = prcLightColor(source.diffuseIndex, globals.colors)
    const emissive = prcLightColor(source.emissiveIndex, globals.colors)
    const specular = prcLightColor(source.specularIndex, globals.colors)
    renderState.lights.push({
      name: source.name, nodeName, type: source.type, enabled: true,
      specular: specular[0] !== 0 || specular[1] !== 0 || specular[2] !== 0,
      color: diffuse, ambientColor: ambient, diffuseColor: diffuse, emissiveColor: emissive, specularColor: specular,
      attenuation: source.attenuation, spotAngle: source.spotAngle, spotExponent: source.spotExponent, intensity: source.intensity,
    })
  }
}

function prcLightColor(index: number, colors: Array<[number, number, number]>): Pdf3DVector3 {
  if (index < 0) return [0, 0, 0]
  const color = colors[index]
  if (color === undefined) throw new Error('PRC decode error: light color index is outside the globals array')
  return color
}

function prcLightMatrix(light: PrcLight): Pdf3DMatrix4 {
  const matrix = identityMatrix()
  matrix[12] = light.location[0]; matrix[13] = light.location[1]; matrix[14] = light.location[2]
  if (light.type === 'directional' || light.type === 'spot') {
    const direction = normalizedPrcVector(light.direction, 'light direction')
    const z: Pdf3DVector3 = [-direction[0], -direction[1], -direction[2]]
    const seed: Pdf3DVector3 = Math.abs(z[2]) < 0.99 ? [0, 0, 1] : [0, 1, 0]
    const x = normalizedPrcVector(cross(seed, z), 'light right direction')
    const y = normalizedPrcVector(cross(z, x), 'light up direction')
    matrix[0] = x[0]; matrix[1] = x[1]; matrix[2] = x[2]
    matrix[4] = y[0]; matrix[5] = y[1]; matrix[6] = y[2]
    matrix[8] = z[0]; matrix[9] = z[1]; matrix[10] = z[2]
  }
  return matrix
}

function appendPrcClippingPlanes(parameters: PrcSceneParameters, world: Pdf3DMatrix4, renderState: PrcRenderState): void {
  for (let index = 0; index < parameters.clippingPlanes.length; index++) {
    const matrix = parameters.absolute ? parameters.clippingPlanes[index]! : multiplyMatrices(world, parameters.clippingPlanes[index]!)
    renderState.clippingPlanes.push({
      point: [matrix[12], matrix[13], matrix[14]],
      normal: normalizedPrcVector([matrix[8], matrix[9], matrix[10]], 'clipping-plane normal'),
    })
  }
}

function prcCameraNode(camera: PrcCamera, name: string, parentName: string): Pdf3DSceneNode {
  const forward = normalizedPrcVector(subtractPrcVectors(camera.look, camera.position), 'camera look direction')
  const right = normalizedPrcVector(cross(forward, camera.up), 'camera right direction')
  const up = normalizedPrcVector(cross(right, forward), 'camera up direction')
  const matrix: Pdf3DMatrix4 = [
    right[0], right[1], right[2], 0,
    up[0], up[1], up[2], 0,
    -forward[0], -forward[1], -forward[2], 0,
    camera.position[0], camera.position[1], camera.position[2], 1,
  ]
  const fieldDegrees = Math.abs(camera.fieldY === 0 ? camera.fieldX : camera.fieldY) * 180 / Math.PI
  if (!camera.orthographic && (fieldDegrees <= 0 || fieldDegrees >= 180)) throw new Error('PRC decode error: camera field of view must be between 0 and pi radians')
  return {
    kind: 'view', name, parents: [{ name: parentName, matrix }], resourceName: name,
    screenUnits: 'fraction', projection: camera.orthographic ? 'orthographic' : 'perspective',
    nearClip: camera.nearClip, farClip: camera.farClip,
    projectionValue: camera.orthographic ? Math.abs(camera.fieldY === 0 ? camera.fieldX : camera.fieldY) / camera.zoom : fieldDegrees,
    viewport: [1, 1, 0, 0], backdrops: [], overlays: [], sourceBlockOffset: 0,
  }
}

function subtractPrcVectors(a: Pdf3DVector3, b: Pdf3DVector3): Pdf3DVector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function normalizedPrcVector(value: Pdf3DVector3, label: string): Pdf3DVector3 {
  const length = Math.sqrt(value[0] * value[0] + value[1] * value[1] + value[2] * value[2])
  if (length <= Number.EPSILON) throw new Error(`PRC decode error: ${label} is zero`)
  return [value[0] / length, value[1] / length, value[2] / length]
}

function appendPartNodes(
  items: PrcRepresentationItem[],
  parentName: string,
  globals: PrcGlobals,
  tessellations: Pdf3DPrimitive[][],
  structureIndex: number,
  primitives: Pdf3DPrimitive[],
  nodes: Pdf3DSceneNode[],
  filters: PrcFilter[],
  references: PrcEntityReference[],
): void {
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    if (item.children !== undefined) { appendPartNodes(item.children, parentName, globals, tessellations, structureIndex, primitives, nodes, filters, references); continue }
    if (!prcItemPassesFilters(item, filters)) continue
    let resourceNames: string[] = []
    if (item.tessellation >= 0) {
      const group = tessellations[item.tessellation]
      if (group === undefined) throw new Error('PRC decode error: representation item tessellation index is outside the array')
      resourceNames = group.map(function (primitive) { return primitive.name })
    } else if (item.points !== undefined) {
      const resourceName = `PRC ${structureIndex} point set ${nodes.length}`
      primitives.push({ kind: 'points', name: resourceName, positions: item.points })
      resourceNames.push(resourceName)
    }
    if (resourceNames.length === 0) continue
    const reference = references.find(function (candidate) { return candidate.targetUniqueId === item.uniqueId })
    const localCoordinate = reference !== undefined && reference.localCoordinate >= 0 ? reference.localCoordinate : item.localCoordinate
    const graphics = reference?.graphics ?? item.graphics
    const local = localCoordinate < 0 ? identityMatrix() : globals.coordinates[localCoordinate]
    if (local === undefined) throw new Error('PRC decode error: local coordinate-system index is outside the globals array')
    const color = graphics.style < 0 ? null : globals.styles[graphics.style]
    if (graphics.style >= 0 && color === undefined) throw new Error('PRC decode error: representation item style index is outside the globals array')
    const renderPasses = graphics.style < 0 ? [] : resolvePrcRenderPasses(graphics.style, globals)
    const surface = graphics.style < 0 ? undefined : resolvePrcSurface(graphics.style, globals)
    for (let resource = 0; resource < resourceNames.length; resource++) {
      nodes.push({
        kind: 'model', name: `PRC ${structureIndex} model ${nodes.length}${item.name === '' ? '' : ` ${item.name}`}`,
        parents: [{ name: parentName, matrix: local }],
        resourceName: resourceNames[resource]!, visibility: (graphics.behavior & 0x2001) === 1 ? 3 : 1, sourceBlockOffset: 0,
        ...(color === null ? {} : { color }),
        ...(surface === undefined ? {} : { surface }),
        ...(renderPasses.length === 0 ? {} : { renderPasses }),
      })
    }
  }
}

function prcItemPassesFilters(item: PrcRepresentationItem, filters: PrcFilter[]): boolean {
  for (let index = 0; index < filters.length; index++) {
    const filter = filters[index]!
    const layerMember = filter.layers.has(item.graphics.layer)
    if (filter.layers.size > 0 && (filter.layerInclusive ? !layerMember : layerMember)) return false
    const entityMember = filter.entityUniqueIds.has(item.uniqueId)
    if (filter.entityUniqueIds.size > 0 && (filter.entityInclusive ? !entityMember : entityMember)) return false
  }
  return true
}

function readTransformationEntity(reader: PrcBitReader): Pdf3DMatrix4 {
  const type = reader.unsigned()
  if (type === 207) {
    const matrix = new Array<number>(16)
    for (let index = 0; index < 16; index++) matrix[index] = reader.double()
    return matrix as Pdf3DMatrix4
  }
  if (type === 202) return readCartesianTransformation(reader)
  throw new Error(`${reader.label}: invalid transformation entity ${type}`)
}

function readCartesianTransformation(reader: PrcBitReader): Pdf3DMatrix4 {
  const behavior = reader.character()
  if ((behavior & ~0x5F) !== 0 || ((behavior & 0x20) !== 0 && (behavior & 4) !== 0)) throw new Error(`${reader.label}: invalid Cartesian transformation behavior`)
  const matrix = identityMatrix()
  if ((behavior & 1) !== 0) { matrix[12] = reader.double(); matrix[13] = reader.double(); matrix[14] = reader.double() }
  if ((behavior & 0x20) !== 0) {
    for (let column = 0; column < 3; column++) for (let row = 0; row < 3; row++) matrix[column * 4 + row] = reader.double()
  } else if ((behavior & 2) !== 0) {
    const x: Pdf3DVector3 = [reader.double(), reader.double(), reader.double()]
    const y: Pdf3DVector3 = [reader.double(), reader.double(), reader.double()]
    const z: Pdf3DVector3 = (behavior & 4) === 0 ? cross(x, y) : cross(y, x)
    for (let row = 0; row < 3; row++) { matrix[row] = x[row]!; matrix[4 + row] = y[row]!; matrix[8 + row] = z[row]! }
  }
  if ((behavior & 0x10) !== 0) {
    for (let column = 0; column < 3; column++) { const scale = reader.double(); for (let row = 0; row < 3; row++) matrix[column * 4 + row] = matrix[column * 4 + row]! * scale }
  } else if ((behavior & 8) !== 0) {
    const scale = reader.double(); for (let column = 0; column < 3; column++) for (let row = 0; row < 3; row++) matrix[column * 4 + row] = matrix[column * 4 + row]! * scale
  }
  if ((behavior & 0x40) !== 0) { matrix[3] = reader.double(); matrix[7] = reader.double(); matrix[11] = reader.double(); matrix[15] = reader.double() }
  return matrix
}

function identityMatrix(): Pdf3DMatrix4 { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
function multiplyMatrices(a: Pdf3DMatrix4, b: Pdf3DMatrix4): Pdf3DMatrix4 {
  const result = new Array<number>(16)
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    let value = 0
    for (let inner = 0; inner < 4; inner++) value += a[inner * 4 + row]! * b[column * 4 + inner]!
    result[column * 4 + row] = value
  }
  return result as Pdf3DMatrix4
}
function cross(a: Pdf3DVector3, b: Pdf3DVector3): Pdf3DVector3 {
  return [cleanZero(a[1] * b[2] - a[2] * b[1]), cleanZero(a[2] * b[0] - a[0] * b[2]), cleanZero(a[0] * b[1] - a[1] * b[0])]
}
function cleanZero(value: number): number { return value === 0 ? 0 : value }

function decodeTessellationSection(data: Uint8Array, structure: PrcFileStructureDescription, globals: PrcGlobals, primitives: Pdf3DPrimitive[]): Pdf3DPrimitive[][] {
  const start = structure.offsets[3]!, end = structure.offsets[4]!
  if (start >= end || end > data.length) throw new Error('PRC decode error: invalid tessellation section offsets')
  const reader = new PrcBitReader(zlibInflate(data.subarray(start, end)), 'PRC tessellation section')
  if (reader.unsigned() !== PRC_TYPE_ASM_FILE_STRUCTURE_TESSELLATION) throw new Error('PRC decode error: invalid tessellation section entity')
  reader.contentPrcBase()
  const count = reader.unsigned()
  const tessellations = new Array<Pdf3DPrimitive[]>(count)
  for (let index = 0; index < count; index++) {
    const decoded = readTessellation(reader, index, globals)
    tessellations[index] = decoded
    primitives.push(...decoded)
  }
  reader.userData()
  return tessellations
}

function readTessellation(reader: PrcBitReader, index: number, globals: PrcGlobals): Pdf3DPrimitive[] {
  const type = reader.unsigned()
  if (type === PRC_TYPE_TESS_3D_WIRE) return [readWireTessellation(reader, index)]
  if (type === PRC_TYPE_TESS_3D_COMPRESSED) return [readCompressedTessellation(reader, index)]
  if (type === PRC_TYPE_TESS_MARKUP) return readMarkupTessellationAfterType(reader, index, globals)
  if (type !== PRC_TYPE_TESS_3D) throw new Error(`${reader.label}: unsupported tessellation entity ${type}`)
  reader.boolean()
  const coordinateCount = reader.unsigned()
  if (coordinateCount % 3 !== 0) throw new Error(`${reader.label}: coordinate count is not divisible by three`)
  const positions = new Array<Pdf3DVector3>(coordinateCount / 3)
  for (let point = 0; point < positions.length; point++) positions[point] = [reader.double(), reader.double(), reader.double()]
  reader.boolean(); reader.boolean()
  const recalculateNormals = reader.boolean()
  if (recalculateNormals) { if (reader.character() !== 0) throw new Error(`${reader.label}: reserved normal recalculation flags are set`); reader.double() }
  const normalCount = reader.unsigned()
  for (let normal = 0; normal < normalCount; normal++) reader.double()
  const wireCount = reader.unsigned()
  const wireIndices = readUnsignedArray(reader, wireCount)
  const triangulatedCount = reader.unsigned()
  const triangulated = readUnsignedArray(reader, triangulatedCount)
  const faceCount = reader.unsigned()
  const triangleIndices: number[] = []
  const triangleColors: Array<[number, number, number, number]> = []
  const triangleTextureIndices: number[][] = []
  const lineIndices: number[] = []
  for (let face = 0; face < faceCount; face++) readFace(reader, positions.length, triangulated, wireIndices, recalculateNormals, triangleIndices, triangleColors, triangleTextureIndices, lineIndices)
  const textureCount = reader.unsigned()
  const textureCoordinates = new Array<number>(textureCount)
  for (let texture = 0; texture < textureCount; texture++) textureCoordinates[texture] = reader.double()
  let trianglePositions = positions
  if (triangleColors.length > 0) {
    trianglePositions = triangleIndices.map(function (position) { return positions[position]! })
    for (let point = 0; point < triangleIndices.length; point++) triangleIndices[point] = point
  }
  const faceTextureCoordinates = prcFaceTextureCoordinates(triangleTextureIndices, textureCoordinates, triangleIndices.length / 3, reader.label)
  const result: Pdf3DPrimitive[] = [{
    kind: 'triangles', name: `PRC tessellation ${index}`, positions: trianglePositions, indices: triangleIndices,
    ...(triangleColors.length === 0 ? {} : { colors: triangleColors }),
    ...(faceTextureCoordinates.length === 0 ? {} : { faceTextureCoordinates }),
  }]
  if (lineIndices.length > 0) result.push({ kind: 'lines', name: `PRC tessellation ${index} wires`, positions, indices: lineIndices })
  return result
}

function readMarkupTessellation(reader: PrcBitReader, index: number): Pdf3DPrimitive[] {
  if (reader.unsigned() !== PRC_TYPE_TESS_MARKUP) throw new Error(`${reader.label}: invalid markup tessellation entity`)
  return readMarkupTessellationAfterType(reader, index, { fonts: [], colors: [], pictures: [], textures: [], materials: [], coordinates: [], styles: [], styleDefinitions: [] })
}

function readMarkupTessellationAfterType(reader: PrcBitReader, index: number, globals: PrcGlobals): Pdf3DPrimitive[] {
  reader.boolean()
  const coordinateCount = reader.unsigned()
  const coordinates = new Array<number>(coordinateCount)
  for (let coordinate = 0; coordinate < coordinateCount; coordinate++) coordinates[coordinate] = reader.double()
  const codeCount = reader.unsigned()
  const codes = readUnsignedArray(reader, codeCount)
  const textCount = reader.unsigned()
  const texts = new Array<string>(textCount)
  for (let text = 0; text < textCount; text++) texts[text] = reader.string() ?? ''
  reader.string()
  const behavior = reader.character()
  if ((behavior & 1) !== 0) return []
  return markupGeometry(codes, coordinates, texts, index, reader.label, globals)
}

function markupGeometry(codes: number[], coordinates: number[], texts: string[], index: number, label: string, globals: PrcGlobals): Pdf3DPrimitive[] {
  const primitives: Pdf3DPrimitive[] = []
  const matrixStack: Pdf3DMatrix4[] = []
  const lineWidthStack: Array<number | undefined> = []
  let matrix = identityMatrix(), codeOffset = 0, coordinateOffset = 0
  let currentColor: [number, number, number, number] | undefined
  let currentLineWidth: number | undefined
  let currentFont = 0
  while (codeOffset < codes.length) {
    const code = codes[codeOffset++]!
    const declaredDoubles = codes[codeOffset++]
    if (declaredDoubles === undefined) throw new Error(`${label}: markup entity lacks its coordinate count`)
    const innerCount = code & 0xFFFFF
    const innerStart = codeOffset
    const isMatrix = (code & 0x08000000) !== 0
    const isExtra = (code & 0x04000000) !== 0
    const extraType = (code & 0x03E00000) >>> 21
    const entersBlock = innerCount > 0 && (isMatrix || (isExtra && (extraType === 6 || extraType === 7 || extraType === 8)))
    if (isMatrix) {
      if (innerCount === 0) matrix = matrixStack.pop() ?? identityMatrix()
      else {
        if (coordinateOffset + 16 > coordinates.length) throw new Error(`${label}: markup matrix is truncated`)
        const local = coordinates.slice(coordinateOffset, coordinateOffset + 16) as Pdf3DMatrix4
        coordinateOffset += 16; matrixStack.push(matrix); matrix = multiplyMatrices(matrix, local)
      }
    } else if (!isExtra || extraType === 2 || extraType === 3 || extraType === 15 || extraType === 16) {
      const pointValues = declaredDoubles
      if (pointValues % 3 !== 0 || coordinateOffset + pointValues > coordinates.length) throw new Error(`${label}: invalid markup geometry coordinate count`)
      const points = new Array<Pdf3DVector3>(pointValues / 3)
      for (let point = 0; point < points.length; point++) {
        const offset = coordinateOffset + point * 3
        points[point] = transformPrcPoint(matrix, [coordinates[offset]!, coordinates[offset + 1]!, coordinates[offset + 2]!])
      }
      coordinateOffset += pointValues
      if (!isExtra) {
        const indices: number[] = []
        for (let point = 1; point < points.length; point++) indices.push(point - 1, point)
        primitives.push({
          kind: 'lines', name: `PRC markup ${index} polyline ${primitives.length}`, positions: points, indices,
          ...(currentColor === undefined ? {} : { colors: markupColors(points.length, currentColor) }),
          ...(currentLineWidth === undefined ? {} : { lineWidth: currentLineWidth }),
        })
      } else if (extraType === 15) primitives.push({
        kind: 'points', name: `PRC markup ${index} points ${primitives.length}`, positions: points,
        ...(currentColor === undefined ? {} : { colors: markupColors(points.length, currentColor) }),
      })
      else {
        const indices: number[] = []
        if (extraType === 2) for (let point = 0; point + 2 < points.length; point += 3) indices.push(point, point + 1, point + 2)
        else if (extraType === 3) for (let point = 0; point + 3 < points.length; point += 4) indices.push(point, point + 1, point + 2, point, point + 2, point + 3)
        else for (let point = 1; point + 1 < points.length; point++) indices.push(0, point, point + 1)
        primitives.push({
          kind: 'triangles', name: `PRC markup ${index} faces ${primitives.length}`, positions: points, indices,
          ...(currentColor === undefined ? {} : { colors: markupColors(points.length, currentColor) }),
        })
      }
    } else if (extraType === 6 || extraType === 7 || extraType === 8) {
      if (innerCount === 0) matrix = matrixStack.pop() ?? identityMatrix()
      else {
        if (coordinateOffset + 3 > coordinates.length) throw new Error(`${label}: markup display-mode origin is truncated`)
        const local = identityMatrix(); local[12] = coordinates[coordinateOffset++]!; local[13] = coordinates[coordinateOffset++]!; local[14] = coordinates[coordinateOffset++]!
        matrixStack.push(matrix); matrix = multiplyMatrices(matrix, local)
      }
    } else if (extraType === 11) {
      if (declaredDoubles !== 0 || innerCount !== 1) throw new Error(`${label}: invalid markup color entity`)
      const colorIndex = codes[innerStart]
      const color = colorIndex === undefined ? undefined : globals.colors[colorIndex]
      if (color === undefined) throw new Error(`${label}: markup color index is outside the globals array`)
      currentColor = [color[0], color[1], color[2], 1]
    } else if (extraType === 1 || extraType === 9) {
      if (innerCount !== 1 || declaredDoubles !== (extraType === 9 ? 3 : 0)) throw new Error(`${label}: invalid markup picture entity`)
      const pictureIndex = codes[innerStart]
      const picture = pictureIndex === undefined ? undefined : globals.pictures[pictureIndex]
      if (picture === undefined) throw new Error(`${label}: markup picture index is outside the globals array`)
      let origin: Pdf3DVector3 = [0, 0, 0]
      if (extraType === 9) {
        origin = [coordinates[coordinateOffset]!, coordinates[coordinateOffset + 1]!, coordinates[coordinateOffset + 2]!]
        coordinateOffset += 3
      }
      primitives.push(markupPicturePrimitive(picture.image, matrix, origin, index, primitives.length))
    } else if (extraType === 13) {
      if (innerCount !== 1 || declaredDoubles !== 0) throw new Error(`${label}: invalid markup font entity`)
      const font = codes[innerStart]
      if (font === undefined || globals.fonts[font] === undefined) throw new Error(`${label}: markup font index is outside the globals array`)
      currentFont = font
    } else if (extraType === 14) {
      if (innerCount !== 1 || declaredDoubles !== 2) throw new Error(`${label}: invalid markup text entity`)
      const textIndex = codes[innerStart]
      const text = textIndex === undefined ? undefined : texts[textIndex]
      const font = globals.fonts[currentFont]
      const width = coordinates[coordinateOffset], height = coordinates[coordinateOffset + 1]
      if (text === undefined) throw new Error(`${label}: markup text index is outside the string array`)
      if (font === undefined) throw new Error(`${label}: markup text has no current font`)
      if (width === undefined || height === undefined || width <= 0 || height <= 0) throw new Error(`${label}: invalid markup text dimensions`)
      coordinateOffset += 2
      primitives.push({
        kind: 'text', name: `PRC markup ${index} text ${primitives.length}`,
        positions: [transformPrcPoint(matrix, [0, 0, 0]), transformPrcPoint(matrix, [width, 0, 0]), transformPrcPoint(matrix, [0, height, 0])],
        text, fontFamily: font.family, fontAttributes: font.attributes,
        ...(currentColor === undefined ? {} : { color: currentColor }),
      })
    } else if (extraType === 17) {
      if (innerCount !== 0 || declaredDoubles > 1) throw new Error(`${label}: invalid markup line-width entity`)
      if (declaredDoubles === 0) currentLineWidth = lineWidthStack.pop()
      else {
        const width = coordinates[coordinateOffset++]
        if (width === undefined || !Number.isFinite(width) || width <= 0) throw new Error(`${label}: invalid markup line width`)
        lineWidthStack.push(currentLineWidth)
        currentLineWidth = width
      }
    } else {
      coordinateOffset += declaredDoubles
      if (coordinateOffset > coordinates.length) throw new Error(`${label}: markup entity coordinates are truncated`)
    }
    if (!entersBlock) codeOffset = innerStart + innerCount
  }
  if (coordinateOffset !== coordinates.length) throw new Error(`${label}: markup tessellation has unused coordinates`)
  if (matrixStack.length !== 0 || lineWidthStack.length !== 0) throw new Error(`${label}: markup tessellation has an unclosed rendering mode`)
  return primitives
}

function markupPicturePrimitive(image: Pdf3DTextureImage, matrix: Pdf3DMatrix4, origin: Pdf3DVector3, markup: number, index: number): Pdf3DPrimitive {
  const positions: Pdf3DVector3[] = [
    transformPrcPoint(matrix, origin),
    transformPrcPoint(matrix, [origin[0] + image.width, origin[1], origin[2]]),
    transformPrcPoint(matrix, [origin[0] + image.width, origin[1] + image.height, origin[2]]),
    transformPrcPoint(matrix, [origin[0], origin[1] + image.height, origin[2]]),
  ]
  const surface: Pdf3DSurfaceMaterial = { lighting: false, ambient: [0, 0, 0], diffuse: [1, 1, 1], emissive: [0, 0, 0], specular: [0, 0, 0], reflectivity: 0, opacity: 1 }
  const layer: Pdf3DTextureLayer = {
    channel: 0, textureName: `PRC markup picture ${markup}:${index}`, image, intensity: 1,
    blendFunction: 3, blendSource: 0, blendConstant: 1, textureMode: 0,
    textureTransform: identityMatrix(), wrapTransform: identityMatrix(), repeat: 0,
  }
  const pass: Pdf3DRenderPass = { material: surface, alphaReference: 0, alphaCompare: 0x0617, frameBufferBlend: 0x0608, alphaTextureChannels: 1, layers: [layer] }
  const uv: Array<Array<[
    [number, number, number, number], [number, number, number, number], [number, number, number, number],
  ]>> = [
    [[[0, 0, 0, 1], [1, 0, 0, 1], [1, 1, 0, 1]]],
    [[[0, 0, 0, 1], [1, 1, 0, 1], [0, 1, 0, 1]]],
  ]
  return { kind: 'triangles', name: `PRC markup ${markup} picture ${index}`, positions, indices: [0, 1, 2, 0, 2, 3], faceRenderPasses: [[pass], [pass]], faceTextureCoordinates: uv }
}

function markupColors(count: number, color: [number, number, number, number]): Array<[number, number, number, number]> {
  return new Array<[number, number, number, number]>(count).fill(color)
}

function transformPrcPoint(matrix: Pdf3DMatrix4, point: Pdf3DVector3): Pdf3DVector3 {
  const x = point[0], y = point[1], z = point[2]
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15]
  return [(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w, (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w, (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w]
}

interface PrcCompressedTriangle {
  points: [number, number, number]
  face: number
}

interface PrcCompressedEdge {
  edge: [number, number]
  previousThird: number
}

function readCompressedTessellation(reader: PrcBitReader, index: number): Pdf3DPrimitive {
  reader.boolean()
  reader.boolean()
  const tolerance = reader.double()
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error(`${reader.label}: compressed tessellation tolerance must be positive`)
  const origin: Pdf3DVector3 = [reader.floatAsBytes(), reader.floatAsBytes(), reader.floatAsBytes()]
  const quantized = reader.compressedIntegerArray()
  const edgeStatus = reader.characterArray(2)
  const triangleFaces = reader.compressedIndiceArray()
  if (triangleFaces.length !== edgeStatus.length) throw new Error(`${reader.label}: compressed triangle-face and edge-status arrays differ in length`)
  const referenceFlagCount = reader.unsigned()
  const referenceFlags = new Array<boolean>(referenceFlagCount)
  let referencedPointCount = 0
  for (let point = 0; point < referenceFlagCount; point++) {
    referenceFlags[point] = reader.boolean()
    if (referenceFlags[point]) referencedPointCount++
  }
  const pointReferences = reader.compressedIndiceArray(referencedPointCount > 3)
  if (pointReferences.length !== referencedPointCount) throw new Error(`${reader.label}: compressed point-reference count does not match its flags`)
  const reconstructed = reconstructCompressedTriangles(origin, tolerance, quantized, edgeStatus, triangleFaces, referenceFlags, pointReferences, reader.label)
  const faceCount = triangleFaces.length === 0 ? 0 : Math.max(...triangleFaces) + 1
  const mustRecalculateNormals = reader.boolean()
  if (mustRecalculateNormals) {
    for (let normal = 0; normal < edgeStatus.length * 3; normal++) reader.boolean()
    reader.double()
    if (reader.character() !== 0) throw new Error(`${reader.label}: reserved compressed normal recalculation flags are set`)
  } else {
    const normalAngleBits = reader.character()
    if (normalAngleBits === 0 || normalAngleBits >= 16) throw new Error(`${reader.label}: invalid compressed normal angle precision`)
    const normalBinarySize = reader.unsigned()
    for (let bit = 0; bit < normalBinarySize; bit++) reader.boolean()
    reader.shortArray(normalAngleBits)
    for (let face = 0; face < faceCount; face++) reader.boolean()
  }
  let colors: Array<[number, number, number, number]> | undefined
  if (reader.boolean()) {
    const coloredFaces = new Array<boolean>(faceCount)
    for (let face = 0; face < faceCount; face++) coloredFaces[face] = reader.boolean()
    const encoded = reader.characterArray(8)
    colors = compressedTriangleColors(reconstructed.triangles, coloredFaces, encoded, reader.label)
  }
  const multipleLineAttributes = reader.boolean()
  if (multipleLineAttributes) for (let face = 0; face < faceCount; face++) reader.boolean()
  reader.shortArray(16)
  if (!reader.boolean()) {
    readCompressedTextureParameter(reader)
    const allFacesHaveTexture = reader.boolean()
    if (!allFacesHaveTexture) for (let face = 0; face < faceCount; face++) reader.boolean()
  }
  if (reader.boolean()) reader.characterArray(8)
  const positions = new Array<Pdf3DVector3>(reconstructed.triangles.length * 3)
  const indices = new Array<number>(positions.length)
  for (let triangle = 0; triangle < reconstructed.triangles.length; triangle++) {
    const source = reconstructed.triangles[triangle]!
    for (let corner = 0; corner < 3; corner++) {
      const output = triangle * 3 + corner
      positions[output] = reconstructed.points[source.points[corner]!]!
      indices[output] = output
    }
  }
  return { kind: 'triangles', name: `PRC compressed tessellation ${index}`, positions, indices, ...(colors === undefined ? {} : { colors }) }
}

function reconstructCompressedTriangles(
  origin: Pdf3DVector3,
  tolerance: number,
  quantized: number[],
  edgeStatus: number[],
  triangleFaces: number[],
  referenceFlags: boolean[],
  pointReferences: number[],
  label: string,
): { points: Pdf3DVector3[]; triangles: PrcCompressedTriangle[] } {
  if (edgeStatus.length === 0) {
    if (quantized.length !== 0 || referenceFlags.length !== 0 || pointReferences.length !== 0) throw new Error(`${label}: empty compressed mesh has point data`)
    return { points: [], triangles: [] }
  }
  if (quantized.length < 9) throw new Error(`${label}: compressed mesh lacks its first triangle coordinates`)
  const points: Pdf3DVector3[] = []
  points.push([origin[0] + quantized[0]! * tolerance, origin[1] + quantized[1]! * tolerance, origin[2] + quantized[2]! * tolerance])
  points.push(addVector(points[0]!, scaleVector([quantized[3]!, quantized[4]!, quantized[5]!], tolerance)))
  points.push(addVector(midpoint(points[0]!, points[1]!), scaleVector([quantized[6]!, quantized[7]!, quantized[8]!], tolerance)))
  const triangles: PrcCompressedTriangle[] = [{ points: [0, 1, 2], face: triangleFaces[0]! }]
  const pending: PrcCompressedEdge[] = []
  appendCompressedNeighbors(triangles[0]!, edgeStatus[0]!, pending, label)
  let quantizedOffset = 9
  let referenceFlagOffset = 0
  let pointReferenceOffset = 0
  for (let triangleIndex = 1; triangleIndex < edgeStatus.length; triangleIndex++) {
    const incoming = pending.pop()
    if (incoming === undefined) throw new Error(`${label}: compressed edge traversal ended before all triangles`)
    const isReference = referenceFlags[referenceFlagOffset++]
    if (isReference === undefined) throw new Error(`${label}: compressed point-reference flags ended before all triangles`)
    let third: number
    if (isReference) {
      const reference = pointReferences[pointReferenceOffset++]
      if (reference === undefined || reference < 0 || reference >= points.length) throw new Error(`${label}: compressed point reference is outside the reconstructed point array`)
      third = reference
    } else {
      if (quantizedOffset + 3 > quantized.length) throw new Error(`${label}: compressed point coordinate array ended before all triangles`)
      const first = points[incoming.edge[0]]!, second = points[incoming.edge[1]]!, previous = points[incoming.previousThird]!
      const basis = compressedPointBasis(first, second, previous, incoming.edge[0], incoming.edge[1])
      const local: Pdf3DVector3 = [quantized[quantizedOffset++]! * tolerance, quantized[quantizedOffset++]! * tolerance, quantized[quantizedOffset++]! * tolerance]
      const point = addVector(basis.origin, addVector(scaleVector(basis.x, local[0]), addVector(scaleVector(basis.y, local[1]), scaleVector(basis.z, local[2]))))
      third = points.length
      points.push(point)
    }
    const triangle: PrcCompressedTriangle = { points: [incoming.edge[0], incoming.edge[1], third], face: triangleFaces[triangleIndex]! }
    triangles.push(triangle)
    appendCompressedNeighbors(triangle, edgeStatus[triangleIndex]!, pending, label)
  }
  if (pending.length !== 0 || quantizedOffset !== quantized.length || referenceFlagOffset !== referenceFlags.length || pointReferenceOffset !== pointReferences.length) {
    throw new Error(`${label}: compressed mesh traversal arrays are inconsistent`)
  }
  return { points, triangles }
}

function appendCompressedNeighbors(triangle: PrcCompressedTriangle, status: number, pending: PrcCompressedEdge[], label: string): void {
  if ((status & ~3) !== 0) throw new Error(`${label}: reserved compressed edge-status bits are set`)
  const points = triangle.points
  if ((status & 1) !== 0) pending.push({ edge: [points[2], points[0]], previousThird: points[1] })
  if ((status & 2) !== 0) pending.push({ edge: [points[1], points[2]], previousThird: points[0] })
}

function compressedPointBasis(first: Pdf3DVector3, second: Pdf3DVector3, previous: Pdf3DVector3, firstIndex: number, secondIndex: number): { origin: Pdf3DVector3; x: Pdf3DVector3; y: Pdf3DVector3; z: Pdf3DVector3 } {
  const low = firstIndex < secondIndex ? first : second
  const high = firstIndex < secondIndex ? second : first
  const origin = midpoint(low, high)
  const x = unitVector(subtractVector(high, low))
  let z = cross(subtractVector(previous, origin), x)
  if (vectorLength(z) <= Number.EPSILON) z = orthogonalVector(x)
  else z = unitVector(z)
  let y = cross(z, x)
  if (vectorLength(y) <= Number.EPSILON) y = orthogonalVector(x)
  else y = unitVector(y)
  return { origin, x, y, z }
}

function compressedTriangleColors(triangles: PrcCompressedTriangle[], coloredFaces: boolean[], encoded: number[], label: string): Array<[number, number, number, number]> {
  const result = new Array<[number, number, number, number]>(triangles.length * 3)
  let offset = 0
  for (let triangle = 0; triangle < triangles.length; triangle++) {
    const colored = coloredFaces[triangles[triangle]!.face]
    for (let corner = 0; corner < 3; corner++) {
      if (!colored) { result[triangle * 3 + corner] = [0.32, 0.52, 0.76, 1]; continue }
      if (offset + 5 > encoded.length) throw new Error(`${label}: compressed point-color array is truncated`)
      const rgba = encoded[offset++]! !== 0
      const red = encoded[offset++]! / 255, green = encoded[offset++]! / 255, blue = encoded[offset++]! / 255, alpha = encoded[offset++]! / 255
      result[triangle * 3 + corner] = [red, green, blue, rgba ? alpha : 1]
    }
  }
  if (offset !== encoded.length) throw new Error(`${label}: compressed point-color array has unused entries`)
  return result
}

function readCompressedTextureParameter(reader: PrcBitReader): void {
  const wordCount = reader.unsigned()
  for (let byte = 0; byte < wordCount * 4; byte++) reader.character()
  reader.unsigned()
  const referenceCount = reader.unsigned()
  const referenceBits = referenceCount <= 1 ? 1 : Math.ceil(Math.log2(referenceCount))
  for (let reference = 0; reference < referenceCount; reference++) reader.bits(referenceBits)
  reader.double()
  const parameterCount = reader.unsigned()
  for (let parameter = 0; parameter < parameterCount; parameter++) reader.floatAsBytes()
}

function addVector(a: Pdf3DVector3, b: Pdf3DVector3): Pdf3DVector3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function subtractVector(a: Pdf3DVector3, b: Pdf3DVector3): Pdf3DVector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function scaleVector(a: Pdf3DVector3, scale: number): Pdf3DVector3 { return [a[0] * scale, a[1] * scale, a[2] * scale] }
function midpoint(a: Pdf3DVector3, b: Pdf3DVector3): Pdf3DVector3 { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] }
function vectorLength(value: Pdf3DVector3): number { return Math.sqrt(value[0] * value[0] + value[1] * value[1] + value[2] * value[2]) }
function unitVector(value: Pdf3DVector3): Pdf3DVector3 { const length = vectorLength(value); if (length <= Number.EPSILON) throw new Error('PRC decode error: degenerate compressed tessellation basis'); return scaleVector(value, 1 / length) }
function orthogonalVector(value: Pdf3DVector3): Pdf3DVector3 {
  const axis: Pdf3DVector3 = Math.abs(value[0]) <= Math.abs(value[1]) && Math.abs(value[0]) <= Math.abs(value[2]) ? [1, 0, 0] : Math.abs(value[1]) <= Math.abs(value[2]) ? [0, 1, 0] : [0, 0, 1]
  return unitVector(cross(value, axis))
}

function readFace(reader: PrcBitReader, positionCount: number, triangulated: number[], wires: number[], recalc: boolean, output: number[], colorOutput: Array<[number, number, number, number]>, textureOutput: number[][], lineOutput: number[]): void {
  if (reader.unsigned() !== PRC_TYPE_TESS_FACE) throw new Error(`${reader.label}: invalid face tessellation entity`)
  const lineAttributeCount = reader.unsigned()
  readUnsignedArray(reader, lineAttributeCount)
  const wireStart = reader.unsigned()
  const wireSizeCount = reader.unsigned()
  const wireSizes = readUnsignedArray(reader, wireSizeCount)
  let wireOffset = wireStart
  for (let index = 0; index < wireSizes.length; index++) {
    const size = wireSizes[index]! & 0x3FFF
    for (let point = 1; point < size; point++) appendPointPair(wires[wireOffset + point - 1]!, wires[wireOffset + point]!, positionCount, lineOutput, reader.label)
    if ((wireSizes[index]! & 0x8000) !== 0 && size > 1) appendPointPair(wires[wireOffset + size - 1]!, wires[wireOffset]!, positionCount, lineOutput, reader.label)
    wireOffset += size
  }
  const flags = reader.unsigned()
  const start = reader.unsigned()
  const sizes = readUnsignedArray(reader, reader.unsigned())
  const textureIndices = reader.unsigned()
  const hasVertexColors = reader.boolean()
  const vertexColors = hasVertexColors ? readVertexColors(reader, countFaceVertices(flags, sizes), 0, false).colors : undefined
  if (lineAttributeCount > 0) reader.unsigned()
  const outputStart = output.length
  if (vertexColors !== undefined && colorOutput.length === 0 && outputStart > 0) {
    for (let color = 0; color < outputStart; color++) colorOutput.push([0.32, 0.52, 0.76, 1])
  }
  expandFace(flags, sizes, triangulated, start, textureIndices, recalc, positionCount, output, colorOutput, textureOutput, vertexColors, reader.label)
  if (vertexColors === undefined && colorOutput.length > 0) {
    for (let color = outputStart; color < output.length; color++) colorOutput.push([0.32, 0.52, 0.76, 1])
  }
}

function expandFace(flags: number, sizes: number[], data: number[], start: number, textureCount: number, recalc: boolean, positionCount: number, output: number[], colorOutput: Array<[number, number, number, number]>, textureOutput: number[][], vertexColors: Array<[number, number, number, number]> | undefined, label: string): void {
  let descriptor = 0, offset = start, colorOffset = 0
  const types = [0x0002, 0x0004, 0x0008, 0x0020, 0x0040, 0x0080, 0x0200, 0x0400, 0x0800, 0x2000, 0x4000, 0x8000]
  for (let typeIndex = 0; typeIndex < types.length; typeIndex++) {
    const type = types[typeIndex]!
    if ((flags & type) === 0) continue
    const simple = (type & 0x2222) !== 0
    const entityCount = sizes[descriptor++] ?? 0
    for (let entity = 0; entity < entityCount; entity++) {
      const vertexCount = simple ? 3 : ((sizes[descriptor++] ?? 0) & 0x3FFFFFFF)
      const oneNormal = (type & 0xF0F0) !== 0
      const textured = type >= 0x0200
      const points = new Array<number>(vertexCount)
      const textures = new Array<number[]>(textureCount)
      for (let texture = 0; texture < textureCount; texture++) textures[texture] = new Array<number>(vertexCount)
      const colors = vertexColors === undefined ? undefined : new Array<[number, number, number, number]>(vertexCount)
      if (!recalc && oneNormal && (flags & 0x40000000) !== 0) offset++
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        if (!recalc && (!oneNormal || (flags & 0x40000000) === 0)) offset++
        if (textured) for (let texture = 0; texture < textureCount; texture++) {
          const textureIndex = data[offset++]
          if (textureIndex === undefined) throw new Error(`${label}: tessellation texture index is truncated`)
          textures[texture]![vertex] = textureIndex
        }
        const raw = data[offset++]
        if (raw === undefined || raw % 3 !== 0 || raw / 3 >= positionCount) throw new Error(`${label}: invalid tessellation point index`)
        points[vertex] = raw / 3
        if (colors !== undefined) {
          const color = vertexColors![colorOffset++]
          if (color === undefined) throw new Error(`${label}: face vertex-color array is truncated`)
          colors[vertex] = color
        }
      }
      if (simple) appendTriangle(points, colors, textures, 0, 1, 2, output, colorOutput, textureOutput)
      else if ((type & 0x4444) !== 0) for (let vertex = 1; vertex + 1 < points.length; vertex++) appendTriangle(points, colors, textures, 0, vertex, vertex + 1, output, colorOutput, textureOutput)
      else for (let vertex = 0; vertex + 2 < points.length; vertex++) {
        if ((vertex & 1) === 0) appendTriangle(points, colors, textures, vertex, vertex + 1, vertex + 2, output, colorOutput, textureOutput)
        else appendTriangle(points, colors, textures, vertex + 1, vertex, vertex + 2, output, colorOutput, textureOutput)
      }
    }
  }
  if (vertexColors !== undefined && colorOffset !== vertexColors.length) throw new Error(`${label}: face vertex-color array has unused entries`)
}

function appendTriangle(points: number[], colors: Array<[number, number, number, number]> | undefined, textures: number[][], a: number, b: number, c: number, output: number[], colorOutput: Array<[number, number, number, number]>, textureOutput: number[][]): void {
  const previousIndexCount = output.length
  for (let texture = textureOutput.length; texture < textures.length; texture++) textureOutput[texture] = new Array<number>(previousIndexCount).fill(-1)
  output.push(points[a]!, points[b]!, points[c]!)
  if (colors !== undefined) colorOutput.push(colors[a]!, colors[b]!, colors[c]!)
  for (let texture = 0; texture < textureOutput.length; texture++) {
    const source = textures[texture]
    if (source === undefined) textureOutput[texture]!.push(-1, -1, -1)
    else textureOutput[texture]!.push(source[a]!, source[b]!, source[c]!)
  }
}

function prcFaceTextureCoordinates(
  indicesBySet: number[][],
  coordinates: number[],
  faceCount: number,
  label: string,
): Array<Array<[
  [number, number, number, number], [number, number, number, number], [number, number, number, number],
]>> {
  if (indicesBySet.length === 0) return []
  const result = new Array<Array<[
    [number, number, number, number], [number, number, number, number], [number, number, number, number],
  ]>>(faceCount)
  for (let face = 0; face < faceCount; face++) {
    const sets = new Array<[
      [number, number, number, number], [number, number, number, number], [number, number, number, number],
    ]>(indicesBySet.length)
    for (let set = 0; set < indicesBySet.length; set++) {
      const indices = indicesBySet[set]!
      if (indices.length !== faceCount * 3) throw new Error(`${label}: texture-coordinate index set does not match the triangle count`)
      const values = new Array<[number, number, number, number]>(3)
      for (let corner = 0; corner < 3; corner++) {
        const offset = indices[face * 3 + corner]!
        if (offset < 0) throw new Error(`${label}: a textured style is applied to a triangle without texture coordinates`)
        if (offset % 2 !== 0 || offset + 1 >= coordinates.length) throw new Error(`${label}: invalid texture-coordinate index`)
        values[corner] = [coordinates[offset]!, coordinates[offset + 1]!, 0, 1]
      }
      sets[set] = values as [
        [number, number, number, number], [number, number, number, number], [number, number, number, number],
      ]
    }
    result[face] = sets
  }
  return result
}

function readWireTessellation(reader: PrcBitReader, index: number): Pdf3DPrimitive {
  reader.boolean()
  const count = reader.unsigned()
  if (count % 3 !== 0) throw new Error(`${reader.label}: wire coordinate count is not divisible by three`)
  const positions = new Array<Pdf3DVector3>(count / 3)
  for (let point = 0; point < positions.length; point++) positions[point] = [reader.double(), reader.double(), reader.double()]
  const wireData = readUnsignedArray(reader, reader.unsigned())
  const indices: number[] = []
  if (wireData.length === 0) for (let point = 1; point < positions.length; point++) indices.push(point - 1, point)
  else {
    let offset = 0
    while (offset < wireData.length) {
      const header = wireData[offset++]!, size = header & 0x0FFFFFFF
      const first = offset
      for (let point = 1; point < size; point++) appendPointPair(wireData[offset + point - 1]!, wireData[offset + point]!, positions.length, indices, reader.label)
      if ((header & 0x40000000) !== 0 && size > 1) appendPointPair(wireData[offset + size - 1]!, wireData[first]!, positions.length, indices, reader.label)
      offset += size
    }
  }
  const decodedColors = reader.boolean() ? readVertexColors(reader, positions.length, indices.length / 2, true) : undefined
  if (decodedColors?.segment) {
    const expandedPositions = new Array<Pdf3DVector3>(indices.length)
    const expandedIndices = new Array<number>(indices.length)
    const expandedColors = new Array<[number, number, number, number]>(indices.length)
    for (let line = 0; line < indices.length / 2; line++) for (let endpoint = 0; endpoint < 2; endpoint++) {
      const output = line * 2 + endpoint
      expandedPositions[output] = positions[indices[output]!]!
      expandedIndices[output] = output
      expandedColors[output] = decodedColors.colors[line]!
    }
    return { kind: 'lines', name: `PRC wire ${index}`, positions: expandedPositions, indices: expandedIndices, colors: expandedColors }
  }
  return { kind: 'lines', name: `PRC wire ${index}`, positions, indices, ...(decodedColors === undefined ? {} : { colors: decodedColors.colors }) }
}

function readVertexColors(reader: PrcBitReader, vertexCount: number, segmentCount: number, allowSegment: boolean): { colors: Array<[number, number, number, number]>; segment: boolean } {
  const rgba = reader.boolean()
  const segment = allowSegment && reader.boolean()
  if (reader.boolean()) throw new Error(`${reader.label}: optimized vertex colors are reserved`)
  const count = segment ? segmentCount : vertexCount
  const colors = new Array<[number, number, number, number]>(count)
  for (let index = 0; index < count; index++) {
    if (index > 0 && reader.boolean()) { colors[index] = colors[index - 1]!; continue }
    colors[index] = [reader.character() / 255, reader.character() / 255, reader.character() / 255, rgba ? reader.character() / 255 : 1]
  }
  return { colors, segment }
}

function countFaceVertices(flags: number, sizes: number[]): number {
  let result = 0, descriptor = 0
  const types = [0x0002, 0x0004, 0x0008, 0x0020, 0x0040, 0x0080, 0x0200, 0x0400, 0x0800, 0x2000, 0x4000, 0x8000]
  for (const type of types) if ((flags & type) !== 0) { const count = sizes[descriptor++] ?? 0; if ((type & 0x2222) !== 0) result += count * 3; else for (let item = 0; item < count; item++) result += (sizes[descriptor++] ?? 0) & 0x3FFFFFFF }
  return result
}

function readUnsignedArray(reader: PrcBitReader, count: number): number[] { const result = new Array<number>(count); for (let index = 0; index < count; index++) result[index] = reader.unsigned(); return result }
function appendPointPair(a: number, b: number, count: number, output: number[], label: string): void { if (a % 3 !== 0 || b % 3 !== 0 || a / 3 >= count || b / 3 >= count) throw new Error(`${label}: invalid wire point index`); output.push(a / 3, b / 3) }

function wordsToDouble(upper: number, lower: number): number {
  const bytes = new Uint8Array(8); const view = new DataView(bytes.buffer)
  view.setUint32(0, lower, true); view.setUint32(4, upper, true)
  return view.getFloat64(0, true)
}
