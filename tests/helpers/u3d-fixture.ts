function u16(value: number): number[] { return [value & 0xFF, (value >>> 8) & 0xFF] }
function i16(value: number): number[] { return u16(value & 0xFFFF) }
function u32(value: number): number[] { return [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF] }
function f32(value: number): number[] {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setFloat32(0, value, true)
  return [...bytes]
}
function f64(value: number): number[] {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value, true)
  return [...bytes]
}
function u64(value: number): number[] {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true)
  return [...bytes]
}
function string(value: string): number[] {
  const bytes = new TextEncoder().encode(value)
  return [...u16(bytes.length), ...bytes]
}
function pad4(values: number[]): void { while ((values.length & 3) !== 0) values.push(0) }

class U3dBitWriter {
  private high = 0xFFFF
  private low = 0
  private underflow = 0
  private byte = 0
  private bit = 0
  private readonly output: number[] = []
  private readonly contexts = new Map<number, number[]>()

  u8(value: number): void { this.symbol(reverse(value), 1, 256) }
  u16(value: number): void { this.u8(value); this.u8(value >>> 8) }
  u32(value: number): void { this.u16(value); this.u16(value >>> 16) }
  f32(value: number): void {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setFloat32(0, value, true)
    for (let index = 0; index < 4; index++) this.u8(bytes[index]!)
  }
  string(value: string): void {
    const bytes = new TextEncoder().encode(value)
    this.u16(bytes.length)
    for (let index = 0; index < bytes.length; index++) this.u8(bytes[index]!)
  }
  staticIndex(value: number, range: number): void { this.symbol(value, 1, range) }
  compressedU32(context: string, value: number): void { this.compressed(contextNumber(context), value, 32) }
  compressedU16(context: string, value: number): void { this.compressed(contextNumber(context), value, 16) }
  compressedU8(context: string, value: number): void { this.compressed(contextNumber(context), value, 8) }
  finish(): number[] {
    this.u32(0)
    if (this.bit !== 0) this.output.push(this.byte)
    return this.output
  }
  private compressed(context: number, value: number, width: number): void {
    let frequencies = this.contexts.get(context)
    if (frequencies === undefined) { frequencies = [1]; this.contexts.set(context, frequencies) }
    const symbol = value + 1
    while (frequencies.length <= symbol) frequencies.push(0)
    let total = 0
    for (let index = 0; index < frequencies.length; index++) total += frequencies[index]!
    if (frequencies[symbol] === 0) {
      this.symbol(0, frequencies[0]!, total)
      frequencies[0] = frequencies[0]! + 1
      if (width === 8) this.u8(value)
      else if (width === 16) this.u16(value)
      else this.u32(value)
      frequencies[symbol] = frequencies[symbol]! + 1
      return
    }
    let cumulative = 0
    for (let index = 0; index < symbol; index++) cumulative += frequencies[index]!
    this.symbol(cumulative, frequencies[symbol]!, total)
    frequencies[symbol] = frequencies[symbol]! + 1
  }
  private symbol(cumulative: number, frequency: number, total: number): void {
    const range = this.high + 1 - this.low
    this.high = this.low - 1 + Math.floor(range * (cumulative + frequency) / total)
    this.low = this.low + Math.floor(range * cumulative / total)
    let bit = this.low >>> 15
    while ((this.high & 0x8000) === (this.low & 0x8000)) {
      this.high = ((this.high & 0x7FFF) << 1) | 1
      this.writeBit(bit)
      while (this.underflow > 0) { this.underflow--; this.writeBit((~bit) & 1) }
      this.low = (this.low & 0x7FFF) << 1
      bit = this.low >>> 15
    }
    while ((this.high & 0x4000) === 0 && (this.low & 0x4000) !== 0) {
      this.high = ((this.high & 0x3FFF) << 1) | 0x8001
      this.low = (this.low & 0x3FFF) << 1
      this.underflow++
    }
  }
  private writeBit(value: number): void {
    this.byte |= value << this.bit
    this.bit++
    if (this.bit === 8) { this.output.push(this.byte); this.byte = 0; this.bit = 0 }
  }
}

const CONTEXTS: Readonly<Record<string, number>> = {
  cFaceCnt: 1, cPointCnt: 1, cLineCnt: 1, cBaseShading: 1, cShading: 65, cFaceOrnt: 2, cThrdPosType: 3, cLocal3rdPos: 4,
  cStayMove0: 15, cStayMove1: 16, cStayMove2: 17, cStayMove3: 18, cStayMove4: 19,
  cPosDiffSign: 20, cPosDiffX: 21, cPosDiffY: 22, cPosDiffZ: 23,
  cNormlCnt: 40, cDiffNormalSign: 41, cDiffNormalX: 42, cDiffNormalY: 43, cDiffNormalZ: 44, cNormlIdx: 45,
  cColorDup: 56, cColorDiff0: 60, cColorDiff1: 61, cColorDiff2: 62, cColorDiff3: 63,
  cDiffuseCount: 99, cDiffuseColorSign: 100, cSpecularCount: 101, cSpecularColorSign: 102, cTexCoordSign: 103,
  cTexCoordCount: 123,
}

function contextNumber(name: string): number {
  const value = CONTEXTS[name]
  if (value === undefined) throw new Error(`Unknown test U3D context ${name}`)
  return value
}

function reverse(value: number): number {
  let result = value & 0xFF
  result = ((result & 0x55) << 1) | ((result >>> 1) & 0x55)
  result = ((result & 0x33) << 2) | ((result >>> 2) & 0x33)
  return ((result & 0x0F) << 4) | (result >>> 4)
}

function block(type: number, data: number[], metadata: number[] = []): number[] {
  const result = [...u32(type), ...u32(data.length), ...u32(metadata.length), ...data]
  pad4(result)
  result.push(...metadata)
  pad4(result)
  return result
}

function groupNode(name: string): number[] {
  return block(0xFFFFFF21, [...string(name), ...u32(0)])
}

function viewNode(): number[] {
  const cameraTransform = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1]
  return block(0xFFFFFF24, [
    ...string('Camera'), ...u32(1), ...string('Root'), ...cameraTransform.flatMap(f32),
    ...string('DefaultView'), ...u32(2),
    ...f32(0.1), ...f32(1000), ...f32(20),
    ...f32(640), ...f32(480), ...f32(0), ...f32(0),
    ...u32(0), ...u32(0),
  ])
}

function modifierChain(): number[] {
  const nested = groupNode('Root')
  const data = [
    ...string('Root'), ...u32(0), ...u32(2),
    ...f32(-2), ...f32(-1), ...f32(-3), ...f32(4), ...f32(5), ...f32(6),
  ]
  pad4(data)
  data.push(...u32(1), ...nested)
  return block(0xFFFFFF14, data)
}

function clodMeshDeclaration(): number[] {
  return block(0xFFFFFF31, [
    ...string('Mesh'), ...u32(0),
    ...u32(0), ...u32(1), ...u32(3), ...u32(1), ...u32(1), ...u32(0), ...u32(0),
    ...u32(1), ...u32(1), ...u32(0), ...u32(0),
    ...u32(3), ...u32(3),
    ...u32(1000), ...u32(1000), ...u32(1000),
    ...f32(1), ...f32(1), ...f32(1), ...f32(1), ...f32(1),
    ...f32(0.9), ...f32(0), ...f32(0),
    ...u32(0),
  ])
}

function meshModifierChain(): number[] {
  const nested = clodMeshDeclaration()
  const data = [
    ...string('Mesh'), ...u32(1), ...u32(2),
    ...f32(0), ...f32(0), ...f32(0), ...f32(1), ...f32(1), ...f32(0),
  ]
  pad4(data)
  data.push(...u32(1), ...nested)
  return block(0xFFFFFF14, data)
}

function modelNode(): number[] {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1]
  return block(0xFFFFFF22, [
    ...string('Model'), ...u32(1), ...string('Root'), ...identity.flatMap(f32),
    ...string('Mesh'), ...u32(3),
  ])
}

function lightNode(): number[] {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  return block(0xFFFFFF23, [
    ...string('Ambient light node'), ...u32(1), ...string('Root'), ...identity.flatMap(f32),
    ...string('Ambient light'),
  ])
}

function baseMeshContinuation(): number[] {
  const writer = new U3dBitWriter()
  writer.string('Mesh'); writer.u32(0)
  writer.u32(1); writer.u32(3); writer.u32(1); writer.u32(1); writer.u32(0); writer.u32(0)
  writer.f32(0); writer.f32(0); writer.f32(0)
  writer.f32(1); writer.f32(0); writer.f32(0)
  writer.f32(0); writer.f32(1); writer.f32(0)
  writer.f32(0); writer.f32(0); writer.f32(1)
  writer.f32(0.2); writer.f32(0.6); writer.f32(0.8); writer.f32(1)
  writer.compressedU32('cBaseShading', 0)
  writer.staticIndex(0, 3); writer.staticIndex(0, 1); writer.staticIndex(0, 1)
  writer.staticIndex(1, 3); writer.staticIndex(0, 1); writer.staticIndex(0, 1)
  writer.staticIndex(2, 3); writer.staticIndex(0, 1); writer.staticIndex(0, 1)
  return block(0xFFFFFF3B, writer.finish())
}

function materialResource(): number[] {
  return block(0xFFFFFF54, [
    ...string('RedMaterial'), ...u32(0x22),
    ...f32(0), ...f32(0), ...f32(0),
    ...f32(1), ...f32(0), ...f32(0),
    ...f32(0), ...f32(0), ...f32(0),
    ...f32(0), ...f32(0), ...f32(0),
    ...f32(0), ...f32(0.5),
  ])
}

function litMaterialResource(): number[] {
  return block(0xFFFFFF54, [
    ...string('LitMaterial'), ...u32(0x03),
    ...f32(1), ...f32(0), ...f32(0),
    ...f32(1), ...f32(0), ...f32(0),
    ...f32(0), ...f32(0), ...f32(0),
    ...f32(0), ...f32(0), ...f32(0),
    ...f32(0), ...f32(1),
  ])
}

function ambientLightResource(): number[] {
  return block(0xFFFFFF51, [
    ...string('Ambient light'), ...u32(1), 0,
    ...f32(0.25), ...f32(0.5), ...f32(1), ...f32(1),
    ...f32(1), ...f32(0), ...f32(0), ...f32(0), ...f32(1),
  ])
}

function litTextureShader(): number[] {
  return block(0xFFFFFF53, [
    ...string('RedShader'), ...u32(0), ...f32(0), ...u32(0x0617), ...u32(0x0608),
    ...u32(1), ...u32(0), ...u32(0), ...string('RedMaterial'),
  ])
}

function lightingShader(): number[] {
  return block(0xFFFFFF53, [
    ...string('RedShader'), ...u32(1), ...f32(0), ...u32(0x0617), ...u32(0x0608),
    ...u32(1), ...u32(0), ...u32(0), ...string('LitMaterial'),
  ])
}

function textureDeclaration(png: Uint8Array): number[] {
  return block(0xFFFFFF55, [
    ...string('Checker'), ...u32(2), ...u32(2), 0x0F, ...u32(1),
    2, 0x0F, ...u16(0), ...u32(png.length),
  ])
}

function textureContinuation(png: Uint8Array): number[] {
  return block(0xFFFFFF5C, [...string('Checker'), ...u32(0), ...png])
}

function texturedShader(): number[] {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  return block(0xFFFFFF53, [
    ...string('RedShader'), ...u32(0), ...f32(0), ...u32(0x0617), ...u32(0x0608),
    ...u32(1), ...u32(1), ...u32(1), ...string('LitMaterial'),
    ...string('Checker'), ...f32(1), 2, 0, ...f32(0), 0,
    ...identity.flatMap(f32), ...identity.flatMap(f32), 3,
  ])
}

function texturedMeshDeclaration(): number[] {
  return block(0xFFFFFF31, [
    ...string('Mesh'), ...u32(0),
    ...u32(0), ...u32(1), ...u32(3), ...u32(1), ...u32(1), ...u32(0), ...u32(3),
    ...u32(1), ...u32(1), ...u32(1), ...u32(2), ...u32(0),
    ...u32(3), ...u32(3),
    ...u32(1000), ...u32(1000), ...u32(1000),
    ...f32(1), ...f32(1), ...f32(1), ...f32(1), ...f32(1),
    ...f32(0.9), ...f32(0), ...f32(0), ...u32(0),
  ])
}

function texturedBaseMeshContinuation(): number[] {
  const writer = new U3dBitWriter()
  writer.string('Mesh'); writer.u32(0)
  writer.u32(1); writer.u32(3); writer.u32(1); writer.u32(1); writer.u32(0); writer.u32(3)
  writer.f32(0); writer.f32(0); writer.f32(0)
  writer.f32(1); writer.f32(0); writer.f32(0)
  writer.f32(0); writer.f32(1); writer.f32(0)
  writer.f32(0); writer.f32(0); writer.f32(1)
  writer.f32(1); writer.f32(1); writer.f32(1); writer.f32(1)
  writer.f32(0); writer.f32(0); writer.f32(0); writer.f32(1)
  writer.f32(1); writer.f32(0); writer.f32(0); writer.f32(1)
  writer.f32(0); writer.f32(1); writer.f32(0); writer.f32(1)
  writer.compressedU32('cBaseShading', 0)
  for (let corner = 0; corner < 3; corner++) {
    writer.staticIndex(corner, 3); writer.staticIndex(0, 1); writer.staticIndex(0, 1); writer.staticIndex(corner, 3)
  }
  return block(0xFFFFFF3B, writer.finish())
}

function shadingModifier(): number[] {
  return block(0xFFFFFF45, [
    ...string('Mesh'), ...u32(1), ...u32(1), ...u32(1), ...u32(1), ...string('RedShader'),
  ])
}

function progressiveMeshDeclaration(): number[] {
  return block(0xFFFFFF31, [
    ...string('ProgressiveMesh'), ...u32(0),
    ...u32(1), ...u32(2), ...u32(4), ...u32(0), ...u32(1), ...u32(0), ...u32(0),
    ...u32(1), ...u32(1), ...u32(0), ...u32(0),
    ...u32(3), ...u32(4),
    ...u32(1000), ...u32(1000), ...u32(1000),
    ...f32(1), ...f32(1), ...f32(1), ...f32(1), ...f32(1),
    ...f32(0.9), ...f32(0), ...f32(0),
    ...u32(0),
  ])
}

function progressiveMeshModifierChain(): number[] {
  const nested = progressiveMeshDeclaration()
  const data = [
    ...string('ProgressiveMesh'), ...u32(1), ...u32(2),
    ...f32(0), ...f32(0), ...f32(0), ...f32(1), ...f32(1), ...f32(1),
  ]
  pad4(data)
  data.push(...u32(1), ...nested)
  return block(0xFFFFFF14, data)
}

function progressiveModelNode(): number[] {
  return block(0xFFFFFF22, [
    ...string('ProgressiveModel'), ...u32(0), ...string('ProgressiveMesh'), ...u32(3),
  ])
}

function progressiveBaseMeshContinuation(): number[] {
  const writer = new U3dBitWriter()
  writer.string('ProgressiveMesh'); writer.u32(0)
  writer.u32(1); writer.u32(3); writer.u32(0); writer.u32(1); writer.u32(0); writer.u32(0)
  writer.f32(0); writer.f32(0); writer.f32(0)
  writer.f32(1); writer.f32(0); writer.f32(0)
  writer.f32(0); writer.f32(1); writer.f32(0)
  writer.f32(0.9); writer.f32(0.3); writer.f32(0.1); writer.f32(1)
  writer.compressedU32('cBaseShading', 0)
  writer.staticIndex(0, 3); writer.staticIndex(0, 1)
  writer.staticIndex(1, 3); writer.staticIndex(0, 1)
  writer.staticIndex(2, 3); writer.staticIndex(0, 1)
  return block(0xFFFFFF3B, writer.finish())
}

function progressiveMeshContinuation(): number[] {
  const writer = new U3dBitWriter()
  writer.string('ProgressiveMesh'); writer.u32(0); writer.u32(3); writer.u32(4)
  writer.staticIndex(0, 3)
  writer.compressedU16('cDiffuseCount', 0)
  writer.compressedU16('cSpecularCount', 0)
  writer.compressedU16('cTexCoordCount', 0)
  writer.compressedU32('cFaceCnt', 1)
  writer.compressedU32('cShading', 0)
  writer.compressedU8('cFaceOrnt', 1)
  writer.compressedU8('cThrdPosType', 1)
  writer.compressedU32('cLocal3rdPos', 1)
  writer.compressedU8('cStayMove2', 0)
  writer.compressedU8('cColorDup', 7)
  writer.compressedU8('cPosDiffSign', 0)
  writer.compressedU32('cPosDiffX', 0)
  writer.compressedU32('cPosDiffY', 0)
  writer.compressedU32('cPosDiffZ', 1)
  return block(0xFFFFFF3C, writer.finish())
}

function pointLineDeclaration(kind: 'points' | 'lines', name: string, elementCount: number, positionCount: number): number[] {
  return block(kind === 'points' ? 0xFFFFFF36 : 0xFFFFFF37, [
    ...string(name), ...u32(0), ...u32(0), ...u32(elementCount), ...u32(positionCount),
    ...u32(0), ...u32(0), ...u32(0), ...u32(0),
    ...u32(1), ...u32(0), ...u32(0), ...u32(0),
    ...u32(1000), ...u32(1000), ...u32(1000),
    ...f32(1), ...f32(1), ...f32(1), ...f32(1), ...f32(1),
    ...u32(0), ...u32(0), ...u32(0), ...u32(0),
  ])
}

function coloredPointDeclaration(): number[] {
  return block(0xFFFFFF36, [
    ...string('ColoredPoints'), ...u32(0), ...u32(0), ...u32(1), ...u32(1),
    ...u32(0), ...u32(1), ...u32(0), ...u32(0),
    ...u32(1), ...u32(1), ...u32(0), ...u32(0),
    ...u32(1000), ...u32(1000), ...u32(1000),
    ...f32(1), ...f32(1), ...f32(1), ...f32(1), ...f32(1),
    ...u32(0), ...u32(0), ...u32(0), ...u32(0),
  ])
}

function coloredPointContinuation(): number[] {
  const writer = new U3dBitWriter()
  writer.string('ColoredPoints'); writer.u32(0); writer.u32(0); writer.u32(1)
  writer.staticIndex(0, 1)
  writer.compressedU8('cPosDiffSign', 0)
  writer.compressedU32('cPosDiffX', 1); writer.compressedU32('cPosDiffY', 2); writer.compressedU32('cPosDiffZ', 0)
  writer.compressedU32('cNormlCnt', 0)
  writer.compressedU32('cPointCnt', 1)
  writer.compressedU32('cBaseShading', 0)
  writer.compressedU32('cNormlIdx', 0)
  writer.compressedU8('cColorDup', 0)
  writer.compressedU8('cDiffNormalSign', 0)
  writer.compressedU32('cColorDiff0', 1); writer.compressedU32('cColorDiff1', 0)
  writer.compressedU32('cColorDiff2', 0); writer.compressedU32('cColorDiff3', 1)
  return block(0xFFFFFF3E, writer.finish())
}

function pointContinuation(): number[] {
  const writer = new U3dBitWriter()
  writer.string('Points'); writer.u32(0); writer.u32(0); writer.u32(1)
  writer.staticIndex(0, 1)
  writer.compressedU8('cPosDiffSign', 0)
  writer.compressedU32('cPosDiffX', 1); writer.compressedU32('cPosDiffY', 2); writer.compressedU32('cPosDiffZ', 0)
  writer.compressedU32('cNormlCnt', 0)
  writer.compressedU32('cPointCnt', 1)
  writer.compressedU32('cBaseShading', 0)
  writer.compressedU32('cNormlIdx', 0)
  return block(0xFFFFFF3E, writer.finish())
}

function lineContinuation(): number[] {
  const writer = new U3dBitWriter()
  writer.string('Lines'); writer.u32(0); writer.u32(0); writer.u32(2)
  writer.staticIndex(0, 1)
  writer.compressedU8('cPosDiffSign', 0)
  writer.compressedU32('cPosDiffX', 0); writer.compressedU32('cPosDiffY', 0); writer.compressedU32('cPosDiffZ', 0)
  writer.compressedU32('cNormlCnt', 0); writer.compressedU32('cLineCnt', 0)
  writer.staticIndex(0, 1)
  writer.compressedU8('cPosDiffSign', 0)
  writer.compressedU32('cPosDiffX', 1); writer.compressedU32('cPosDiffY', 0); writer.compressedU32('cPosDiffZ', 0)
  writer.compressedU32('cNormlCnt', 0); writer.compressedU32('cLineCnt', 1)
  writer.compressedU32('cBaseShading', 0); writer.staticIndex(0, 1)
  writer.compressedU32('cNormlIdx', 0); writer.compressedU32('cNormlIdx', 0)
  return block(0xFFFFFF3F, writer.finish())
}

export function buildU3dFixture(): Uint8Array {
  const chain = modifierChain()
  const meshChain = meshModifierChain()
  const model = modelNode()
  const view = viewNode()
  const baseMesh = baseMeshContinuation()
  const headerDataLength = 32
  const headerBlockLength = 12 + headerDataLength
  const declarationSize = headerBlockLength + chain.length + meshChain.length + model.length + view.length
  const fileSize = declarationSize + baseMesh.length
  const headerData = [
    ...i16(0), ...i16(1), ...u32(0x0C), ...u32(declarationSize), ...u64(fileSize), ...u32(106), ...f64(0.001),
  ]
  const header = block(0x00443355, headerData)
  return new Uint8Array([...header, ...chain, ...meshChain, ...model, ...view, ...baseMesh])
}

export function buildU3dFixtureWithoutView(): Uint8Array {
  const chain = modifierChain()
  const meshChain = meshModifierChain()
  const model = modelNode()
  const baseMesh = baseMeshContinuation()
  const headerBlockLength = 12 + 32
  const declarationSize = headerBlockLength + chain.length + meshChain.length + model.length
  const fileSize = declarationSize + baseMesh.length
  const header = block(0x00443355, [
    ...i16(0), ...i16(1), ...u32(0x0C), ...u32(declarationSize), ...u64(fileSize), ...u32(106), ...f64(0.001),
  ])
  return new Uint8Array([...header, ...chain, ...meshChain, ...model, ...baseMesh])
}

export function buildProgressiveU3dFixture(): Uint8Array {
  const meshChain = progressiveMeshModifierChain()
  const model = progressiveModelNode()
  const baseMesh = progressiveBaseMeshContinuation()
  const progressive = progressiveMeshContinuation()
  const headerDataLength = 32
  const headerBlockLength = 12 + headerDataLength
  const declarationSize = headerBlockLength + meshChain.length + model.length
  const fileSize = declarationSize + baseMesh.length + progressive.length
  const header = block(0x00443355, [
    ...i16(0), ...i16(1), ...u32(0x0C), ...u32(declarationSize), ...u64(fileSize), ...u32(106), ...f64(0.001),
  ])
  return new Uint8Array([...header, ...meshChain, ...model, ...baseMesh, ...progressive])
}

export function buildStyledU3dFixture(): Uint8Array {
  const mesh = clodMeshDeclaration()
  const model = modelNode()
  const material = materialResource()
  const shader = litTextureShader()
  const shading = shadingModifier()
  const continuation = baseMeshContinuation()
  const headerBlockLength = 12 + 32
  const declarationSize = headerBlockLength + mesh.length + model.length + material.length + shader.length + shading.length
  const fileSize = declarationSize + continuation.length
  const header = block(0x00443355, [
    ...i16(0), ...i16(1), ...u32(0x0C), ...u32(declarationSize), ...u64(fileSize), ...u32(106), ...f64(0.001),
  ])
  return new Uint8Array([...header, ...mesh, ...model, ...material, ...shader, ...shading, ...continuation])
}

/** U3D scene with an enabled ambient light connected to a lit material. */
export function buildLitU3dFixture(): Uint8Array {
  const mesh = meshModifierChain()
  const model = modelNode()
  const lightNodeBlock = lightNode()
  const material = litMaterialResource()
  const shader = lightingShader()
  const shading = shadingModifier()
  const light = ambientLightResource()
  const continuation = baseMeshContinuation()
  const headerBlockLength = 12 + 32
  const declarationSize = headerBlockLength + mesh.length + model.length + lightNodeBlock.length + material.length + shader.length + shading.length + light.length
  const fileSize = declarationSize + continuation.length
  const header = block(0x00443355, [
    ...i16(0), ...i16(1), ...u32(0x0C), ...u32(declarationSize), ...u64(fileSize), ...u32(106), ...f64(0.001),
  ])
  return new Uint8Array([...header, ...mesh, ...model, ...lightNodeBlock, ...material, ...shader, ...shading, ...light, ...continuation])
}

/** U3D scene with an embedded PNG texture mapped across one triangle. */
export function buildTexturedU3dFixture(): Uint8Array {
  const png = encodePngRgba(2, 2, new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]))
  const mesh = texturedMeshDeclaration(), model = modelNode(), material = litMaterialResource()
  const shader = texturedShader(), shading = shadingModifier(), texture = textureDeclaration(png)
  const continuation = texturedBaseMeshContinuation(), textureData = textureContinuation(png)
  const headerBlockLength = 12 + 32
  const declarationSize = headerBlockLength + mesh.length + model.length + material.length + shader.length + shading.length + texture.length
  const fileSize = declarationSize + continuation.length + textureData.length
  const header = block(0x00443355, [
    ...i16(0), ...i16(1), ...u32(0x0C), ...u32(declarationSize), ...u64(fileSize), ...u32(106), ...f64(0.001),
  ])
  return new Uint8Array([...header, ...mesh, ...model, ...material, ...shader, ...shading, ...texture, ...continuation, ...textureData])
}

export function buildPointLineU3dFixture(): Uint8Array {
  const pointDeclaration = pointLineDeclaration('points', 'Points', 1, 1)
  const lineDeclaration = pointLineDeclaration('lines', 'Lines', 1, 2)
  const points = pointContinuation()
  const lines = lineContinuation()
  const headerDataLength = 32
  const headerBlockLength = 12 + headerDataLength
  const declarationSize = headerBlockLength + pointDeclaration.length + lineDeclaration.length
  const fileSize = declarationSize + points.length + lines.length
  const header = block(0x00443355, [
    ...i16(0), ...i16(1), ...u32(0x0C), ...u32(declarationSize), ...u64(fileSize), ...u32(106), ...f64(1),
  ])
  return new Uint8Array([...header, ...pointDeclaration, ...lineDeclaration, ...points, ...lines])
}

export function buildColoredPointU3dFixture(): Uint8Array {
  const declaration = coloredPointDeclaration()
  const continuation = coloredPointContinuation()
  const headerBlockLength = 12 + 32
  const declarationSize = headerBlockLength + declaration.length
  const fileSize = declarationSize + continuation.length
  const header = block(0x00443355, [
    ...i16(0), ...i16(1), ...u32(0x0C), ...u32(declarationSize), ...u64(fileSize), ...u32(106), ...f64(1),
  ])
  return new Uint8Array([...header, ...declaration, ...continuation])
}
import { encodePngRgba } from '../../src/image/png-encoder.js'
