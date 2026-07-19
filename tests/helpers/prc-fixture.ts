import { deflateSync } from 'node:zlib'

function u32(value: number): number[] {
  return [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF]
}

class PrcBitWriter {
  private readonly bytes: number[] = []
  private current = 0
  private count = 0

  bit(value: number | boolean): void {
    if (value === 1 || value === true) this.current |= 1 << (7 - this.count)
    this.count++
    if (this.count === 8) { this.bytes.push(this.current); this.current = 0; this.count = 0 }
  }

  bits(value: number, count: number): void {
    for (let bit = count - 1; bit >= 0; bit--) this.bit((value >>> bit) & 1)
  }

  character(value: number): void { this.bits(value, 8) }

  floatAsBytes(value: number): void {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setFloat32(0, value, true)
    for (const byte of bytes) this.character(byte)
  }

  unsigned(value: number): void {
    let remaining = value >>> 0
    while (remaining !== 0) {
      this.bit(1); this.character(remaining & 0xFF); remaining >>>= 8
    }
    this.bit(0)
  }

  integer(value: number): void {
    if (value < 0 || value > 0x7F) throw new Error('PRC fixture integer is outside the direct positive range')
    if (value === 0) { this.bit(0); return }
    this.bit(1); this.character(value); this.bit(0)
  }

  string(value: string | null): void {
    if (value === null) { this.bit(0); return }
    const bytes = new TextEncoder().encode(value)
    this.bit(1); this.unsigned(bytes.length)
    for (const byte of bytes) this.character(byte)
  }

  name(value: string): void { this.bit(0); this.string(value) }

  double(value: -1 | 0 | 1): void {
    if (value === 0) { this.bits(0b01, 2); return }
    this.bits(0, 4); this.bit(value < 0)
  }

  variableInteger(value: number, bitCount: number): void {
    this.bit(value < 0)
    this.bits(Math.abs(value), bitCount - 1)
  }

  directCharacterArray(values: number[], writeCompressionFlag = true): void {
    if (writeCompressionFlag) this.bit(0)
    this.unsigned(values.length)
    for (const value of values) this.character(value)
  }

  huffmanConstant(value: number, valueBitCount: number, count: number): void {
    this.bit(1)
    const packedBits: number[] = []
    const append = function (item: number, bits: number): void {
      for (let bit = 0; bit < bits; bit++) packedBits.push((item >>> bit) & 1)
    }
    append(1, valueBitCount + 1)
    append(1, 8)
    append(value, valueBitCount)
    append(0, 1)
    append(count, 32)
    const wordCount = Math.ceil(packedBits.length / 32)
    this.unsigned(wordCount)
    for (let word = 0; word < wordCount; word++) {
      let encoded = 0
      for (let bit = 0; bit < 32; bit++) encoded += (packedBits[word * 32 + bit] ?? 0) * 2 ** bit
      this.bits(encoded >>> 0, 32)
    }
    this.unsigned(packedBits.length - (wordCount - 1) * 32)
  }

  compressedIntegers(values: number[]): void {
    const widths = values.map(integerBitWidth)
    this.directCharacterArray(widths)
    for (let index = 0; index < values.length; index++) this.variableInteger(values[index]!, widths[index]!)
  }

  compressedIndices(values: number[], writeCompressionFlag = true): void {
    if (values.length === 0) { this.directCharacterArray([], writeCompressionFlag); return }
    const widths = new Array<number>(values.length)
    widths[0] = integerBitWidth(values[0]!)
    for (let index = 1; index < values.length; index++) {
      const width = integerBitWidth(values[index]! - values[index - 1]!)
      widths[index] = (width - widths[index - 1]!) & 0x3F
    }
    this.directCharacterArray(widths, writeCompressionFlag)
    let width = widths[0]!
    this.variableInteger(values[0]!, width)
    for (let index = 1; index < values.length; index++) {
      const raw = widths[index]!
      width += raw >= 32 ? raw - 64 : raw
      this.variableInteger(values[index]! - values[index - 1]!, width)
    }
  }

  finish(): Uint8Array {
    if (this.count !== 0) this.bytes.push(this.current)
    return new Uint8Array(this.bytes)
  }
}

function integerBitWidth(value: number): number {
  const magnitude = Math.abs(value)
  return 1 + (magnitude === 0 ? 0 : Math.floor(Math.log2(magnitude)) + 1)
}

function writeBase(writer: PrcBitWriter, name: string): void {
  writer.unsigned(0)
  writer.name(name)
}

function writeReferenceableBase(writer: PrcBitWriter, name: string): void {
  writeBase(writer, name)
  writer.unsigned(0); writer.unsigned(0); writer.unsigned(0)
}

function writeCurrentGraphics(writer: PrcBitWriter): void { writer.bit(1) }
function writeGraphics(writer: PrcBitWriter, style: number): void {
  writer.bit(0); writer.unsigned(0); writer.unsigned(style + 1); writer.character(1); writer.character(0)
}

function writeTriangleTessellation(writer: PrcBitWriter): void {
  writer.unsigned(172)
  writer.bit(1)
  writer.unsigned(9)
  writer.double(0); writer.double(0); writer.double(0)
  writer.double(1); writer.double(0); writer.double(0)
  writer.double(0); writer.double(1); writer.double(0)
  writer.bit(0); writer.bit(1); writer.bit(1)
  writer.character(0); writer.double(0)
  writer.unsigned(0)
  writer.unsigned(0)
  writer.unsigned(3); writer.unsigned(0); writer.unsigned(3); writer.unsigned(6)
  writer.unsigned(1)
  writer.unsigned(174)
  writer.unsigned(0)
  writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(0x0002)
  writer.unsigned(0)
  writer.unsigned(1); writer.unsigned(1)
  writer.unsigned(0)
  writer.bit(0)
  writer.unsigned(0)
}

function tessellationSection(compressed = false): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(305)
  writeBase(writer, 'Tessellation section')
  writer.unsigned(1)
  if (compressed) writeCompressedTriangleTessellation(writer)
  else writeTriangleTessellation(writer)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function markupTessellationSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(305); writeBase(writer, 'Tessellation section'); writer.unsigned(1)
  writer.unsigned(176); writer.bit(0); writer.unsigned(9)
  writer.double(0); writer.double(0); writer.double(0)
  writer.double(1); writer.double(0); writer.double(0)
  writer.double(0); writer.double(1); writer.double(0)
  writer.unsigned(2); writer.unsigned(0x04000000 + (2 << 21)); writer.unsigned(9)
  writer.unsigned(0); writer.string('Triangle markup'); writer.character(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function styledMarkupTessellationSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(305); writeBase(writer, 'Tessellation section'); writer.unsigned(1)
  writer.unsigned(176); writer.bit(0); writer.unsigned(7)
  writer.double(1)
  writer.double(0); writer.double(0); writer.double(0)
  writer.double(1); writer.double(0); writer.double(0)
  writer.unsigned(9)
  writer.unsigned(0x04000000 + (11 << 21) + 1); writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(0x04000000 + (17 << 21)); writer.unsigned(1)
  writer.unsigned(0); writer.unsigned(6)
  writer.unsigned(0x04000000 + (17 << 21)); writer.unsigned(0)
  writer.unsigned(0); writer.string('Styled markup'); writer.character(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function writeCompressedTriangleTessellation(writer: PrcBitWriter): void {
  writer.unsigned(173)
  writer.bit(1); writer.bit(1)
  writer.double(1)
  writer.floatAsBytes(0); writer.floatAsBytes(0); writer.floatAsBytes(0)
  writer.compressedIntegers([0, 0, 0, 1, 0, 0, 0, 1, 0])
  writer.huffmanConstant(0, 2, 1)
  writer.compressedIndices([0])
  writer.unsigned(0)
  writer.compressedIndices([], false)
  writer.bit(1)
  writer.bit(0); writer.bit(0); writer.bit(0)
  writer.double(0); writer.character(0)
  writer.bit(1); writer.bit(1)
  const colors: number[] = []
  for (let corner = 0; corner < 3; corner++) colors.push(1, 255, 0, 0, 255)
  writer.directCharacterArray(colors)
  writer.bit(0)
  writer.bit(0); writer.unsigned(1); writer.character(0); writer.character(0)
  writer.bit(1)
  writer.bit(0)
}

function globalsSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(0)
  writer.unsigned(303)
  writeBase(writer, 'Globals section')
  writer.unsigned(0)
  writer.double(0); writer.double(0)
  writer.string(null)
  for (let category = 0; category < 9; category++) writer.unsigned(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function transformedGlobalsSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(0); writer.unsigned(303)
  writeBase(writer, 'Globals section')
  writer.unsigned(0)
  writer.double(0); writer.double(0); writer.string(null)
  for (let category = 0; category < 8; category++) writer.unsigned(0)
  writer.unsigned(1)
  writer.unsigned(240)
  writeReferenceableBase(writer, 'Local coordinate')
  writeCurrentGraphics(writer)
  writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(202); writer.character(1)
  writer.double(1); writer.double(0); writer.double(0)
  writer.unsigned(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function styledGlobalsSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(0); writer.unsigned(303); writeBase(writer, 'Globals section'); writer.unsigned(0)
  writer.double(0); writer.double(0); writer.string(null); writer.unsigned(0)
  writer.unsigned(1); writer.double(1); writer.double(0); writer.double(0)
  writer.unsigned(0); writer.unsigned(0); writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(1)
  writer.unsigned(701); writeReferenceableBase(writer, 'Red style')
  writer.double(0); writer.bit(0); writer.unsigned(0); writer.bit(0); writer.unsigned(1)
  writer.bit(1); writer.character(128)
  writer.bit(0); writer.bit(0); writer.bit(0)
  writer.unsigned(0)
  writer.unsigned(1)
  writer.unsigned(240); writeReferenceableBase(writer, 'Local coordinate'); writeCurrentGraphics(writer)
  writer.unsigned(0); writer.unsigned(0); writer.unsigned(202); writer.character(1)
  writer.double(1); writer.double(0); writer.double(0); writer.unsigned(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function texturedGlobalsSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(0); writer.unsigned(303); writeBase(writer, 'Globals section'); writer.unsigned(0)
  writer.double(0); writer.double(0); writer.string(null); writer.unsigned(0)
  writer.unsigned(2)
  writer.double(1); writer.double(1); writer.double(1)
  writer.double(0); writer.double(0); writer.double(0)
  writer.unsigned(1)
  writer.unsigned(703); writeBase(writer, 'Red picture'); writer.integer(3); writer.unsigned(1); writer.unsigned(1); writer.unsigned(1)
  writer.unsigned(1)
  writer.unsigned(712); writeReferenceableBase(writer, 'Texture'); writer.unsigned(1); writer.character(2); writer.integer(2)
  writer.unsigned(0x0F); writer.unsigned(0); writer.unsigned(0); writer.integer(3)
  writer.integer(1); writer.integer(1); writer.character(0); writer.integer(2); writer.integer(2); writer.bit(0)
  writer.unsigned(2)
  writer.unsigned(702); writeReferenceableBase(writer, 'Material')
  writer.unsigned(1); writer.unsigned(1); writer.unsigned(2); writer.unsigned(2)
  writer.double(0); writer.double(1); writer.double(1); writer.double(1); writer.double(1)
  writer.unsigned(711); writeReferenceableBase(writer, 'Texture application')
  writer.unsigned(1); writer.unsigned(1); writer.unsigned(0); writer.unsigned(1)
  writer.unsigned(0)
  writer.unsigned(1)
  writer.unsigned(701); writeReferenceableBase(writer, 'Textured style')
  writer.double(0); writer.bit(0); writer.unsigned(0); writer.bit(1); writer.unsigned(2)
  writer.bit(0); writer.bit(0); writer.bit(0); writer.bit(0)
  writer.unsigned(0); writer.unsigned(1)
  writer.unsigned(240); writeReferenceableBase(writer, 'Local coordinate'); writeCurrentGraphics(writer)
  writer.unsigned(0); writer.unsigned(0); writer.unsigned(202); writer.character(0); writer.unsigned(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function materialGlobalsSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(0); writer.unsigned(303); writeBase(writer, 'Globals section'); writer.unsigned(0)
  writer.double(0); writer.double(0); writer.string(null); writer.unsigned(0)
  writer.unsigned(3)
  writer.double(1); writer.double(1); writer.double(1)
  writer.double(0); writer.double(0); writer.double(0)
  writer.double(1); writer.double(0); writer.double(0)
  writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(1)
  writer.unsigned(702); writeReferenceableBase(writer, 'Lit material')
  writer.unsigned(1); writer.unsigned(1); writer.unsigned(2); writer.unsigned(2)
  writer.double(0); writer.double(1); writer.double(1); writer.double(1); writer.double(1)
  writer.unsigned(0)
  writer.unsigned(1)
  writer.unsigned(701); writeReferenceableBase(writer, 'Material style')
  writer.double(0); writer.bit(0); writer.unsigned(0); writer.bit(1); writer.unsigned(1)
  writer.bit(0); writer.bit(0); writer.bit(0); writer.bit(0)
  writer.unsigned(0); writer.unsigned(1)
  writer.unsigned(240); writeReferenceableBase(writer, 'Local coordinate'); writeCurrentGraphics(writer)
  writer.unsigned(0); writer.unsigned(0); writer.unsigned(202); writer.character(0); writer.unsigned(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function markupResourceGlobalsSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(0); writer.unsigned(303); writeBase(writer, 'Globals section'); writer.unsigned(0)
  writer.double(0); writer.double(0); writer.string('Helvetica')
  writer.unsigned(1); writer.string('Helvetica'); writer.unsigned(0); writer.unsigned(1); writer.unsigned(11); writer.character(2)
  writer.unsigned(1); writer.double(0); writer.double(0); writer.double(1)
  writer.unsigned(1)
  writer.unsigned(703); writeBase(writer, 'Green picture'); writer.integer(3); writer.unsigned(1); writer.unsigned(1); writer.unsigned(1)
  for (let category = 0; category < 6; category++) writer.unsigned(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function texturedTessellationSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(305); writeBase(writer, 'Tessellation section'); writer.unsigned(1)
  writer.unsigned(172); writer.bit(1); writer.unsigned(9)
  writer.double(0); writer.double(0); writer.double(0)
  writer.double(1); writer.double(0); writer.double(0)
  writer.double(0); writer.double(1); writer.double(0)
  writer.bit(0); writer.bit(1); writer.bit(1); writer.character(0); writer.double(0); writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(6); for (const value of [0, 0, 2, 3, 4, 6]) writer.unsigned(value)
  writer.unsigned(1); writer.unsigned(174); writer.unsigned(0); writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(0x0200); writer.unsigned(0); writer.unsigned(1); writer.unsigned(1); writer.unsigned(1); writer.bit(0)
  writer.unsigned(6); writer.double(0); writer.double(0); writer.double(1); writer.double(0); writer.double(0); writer.double(1)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function textPictureMarkupTessellationSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(305); writeBase(writer, 'Tessellation section'); writer.unsigned(1)
  writer.unsigned(176); writer.bit(0); writer.unsigned(2); writer.double(1); writer.double(1)
  writer.unsigned(9)
  writer.unsigned(0x04000000 + (13 << 21) + 1); writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(0x04000000 + (14 << 21) + 1); writer.unsigned(2); writer.unsigned(0)
  writer.unsigned(0x04000000 + (1 << 21) + 1); writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(1); writer.string('Hi'); writer.string('Text and picture'); writer.character(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function treeSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(304)
  writeBase(writer, 'Tree section')
  writer.unsigned(0)
  writer.unsigned(0)
  writer.unsigned(302)
  writeBase(writer, 'File structure')
  writer.unsigned(0)
  writer.unsigned(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

function transformedTreeSection(styled = false, filtered = false, sceneCamera = false, sceneBackground = false, sceneEffect: 'light' | 'clip' | null = null): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(304); writeBase(writer, 'Tree section')
  writer.unsigned(1)
  writer.unsigned(311); writeReferenceableBase(writer, 'Part'); writeCurrentGraphics(writer)
  for (let bound = 0; bound < 6; bound++) writer.double(bound === 3 || bound === 4 ? 1 : 0)
  writer.unsigned(1)
  writer.unsigned(232); writeReferenceableBase(writer, 'Triangle')
  if (styled) writeGraphics(writer, 0); else writeCurrentGraphics(writer)
  writer.unsigned(1); writer.unsigned(1)
  writer.bit(0); writer.bit(1); writer.unsigned(0)
  for (let markup = 0; markup < 4; markup++) writer.unsigned(0)
  writer.unsigned(0)
  writer.unsigned(0)
  writer.unsigned(1)
  writer.unsigned(310); writeReferenceableBase(writer, 'Root'); writeCurrentGraphics(writer)
  writer.unsigned(1); writer.unsigned(0); writer.unsigned(0); writer.unsigned(0)
  writer.character(0)
  writer.bit(1); writer.double(1); writer.character(0); writer.unsigned(0)
  writer.bit(1); writer.character(2)
  writer.double(0); writer.double(1); writer.double(0)
  writer.double(-1); writer.double(0); writer.double(0)
  writer.unsigned(0)
  for (let markup = 0; markup < 4; markup++) writer.unsigned(0)
  writer.unsigned(0); writer.bit(0)
  if (filtered) {
    writer.unsigned(1)
    writer.unsigned(320); writeReferenceableBase(writer, 'Active filter'); writer.bit(1)
    writer.bit(0); writer.unsigned(0)
    writer.bit(1); writer.unsigned(1)
    writer.unsigned(203); writeReferenceableBase(writer, 'Excluded item'); writeCurrentGraphics(writer)
    writer.unsigned(0); writer.bit(1); writer.unsigned(205); writer.unsigned(232); writer.bit(1); writer.unsigned(999); writer.unsigned(0)
    writer.unsigned(0)
  } else writer.unsigned(0)
  if (sceneCamera || sceneEffect !== null) {
    writer.unsigned(1)
    writer.unsigned(741); writeReferenceableBase(writer, 'Active scene'); writer.bit(1)
    writer.unsigned(sceneEffect === null ? 0 : 1)
    if (sceneEffect !== null) {
      writer.unsigned(731); writeReferenceableBase(writer, 'Ambient light')
      writer.unsigned(3); writer.unsigned(3); writer.unsigned(2); writer.unsigned(2)
    }
    writer.bit(sceneCamera)
    if (sceneCamera) {
      writer.unsigned(742); writeReferenceableBase(writer, 'Scene camera'); writer.bit(1)
      writer.double(1); writer.double(0); writer.double(0)
      writer.double(0); writer.double(0); writer.double(0)
      writer.double(0); writer.double(0); writer.double(1)
      writer.double(1); writer.double(1); writer.double(1); writer.double(0); writer.double(1); writer.double(1)
    }
    writer.bit(0)
    writer.unsigned(sceneEffect === 'clip' ? 1 : 0)
    if (sceneEffect === 'clip') {
      writer.unsigned(86); writer.bit(0); writer.unsigned(0); writer.unsigned(202); writer.character(2)
      writer.double(0); writer.double(1); writer.double(0)
      writer.double(0); writer.double(0); writer.double(-1)
      for (let value = 0; value < 8; value++) writer.double(0)
    }
    writer.unsigned(sceneBackground ? 1 : 0); writer.unsigned(0); writer.unsigned(0); writer.bit(1)
  } else writer.unsigned(0)
  writer.unsigned(0)
  writer.unsigned(302); writeBase(writer, 'File structure')
  writer.unsigned(0); writer.unsigned(1); writer.unsigned(0)
  return deflateSync(writer.finish())
}

function linkedMarkupTreeSection(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(304); writeBase(writer, 'Tree section')
  writer.unsigned(1)
  writer.unsigned(311); writeReferenceableBase(writer, 'Part'); writeCurrentGraphics(writer)
  for (let bound = 0; bound < 6; bound++) writer.double(bound === 3 || bound === 4 ? 1 : 0)
  writer.unsigned(0)
  writer.unsigned(0)
  writer.unsigned(0)
  writer.unsigned(1)
  writer.unsigned(502); writeReferenceableBase(writer, 'Markup'); writeCurrentGraphics(writer)
  writer.unsigned(1); writer.unsigned(0)
  writer.unsigned(0); writer.unsigned(0); writer.unsigned(1); writer.unsigned(0)
  writer.unsigned(0)
  writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(1)
  writer.unsigned(310); writeReferenceableBase(writer, 'Root'); writeCurrentGraphics(writer)
  writer.unsigned(1); writer.unsigned(0); writer.unsigned(0); writer.unsigned(0)
  writer.character(0)
  writer.bit(1); writer.double(1); writer.character(0); writer.unsigned(0)
  writer.bit(0)
  writer.unsigned(0)
  for (let markup = 0; markup < 4; markup++) writer.unsigned(0)
  writer.unsigned(0); writer.bit(0); writer.unsigned(0); writer.unsigned(0); writer.unsigned(0)
  writer.unsigned(302); writeBase(writer, 'File structure')
  writer.unsigned(0); writer.unsigned(1); writer.unsigned(0)
  return deflateSync(writer.finish())
}

function modelFile(): Uint8Array {
  const writer = new PrcBitWriter()
  writer.unsigned(0)
  writer.unsigned(301)
  writeBase(writer, 'Model file')
  writer.bit(1); writer.double(1)
  writer.unsigned(0)
  writer.unsigned(0)
  writer.unsigned(0)
  return deflateSync(writer.finish())
}

/** Minimal ISO 14739-1 file containing one non-compressed triangle tessellation. */
export function buildPrcFixture(): Uint8Array {
  const globals = globalsSection()
  const tree = treeSection()
  const tessellation = tessellationSection()
  const model = modelFile()
  const headerSize = 107
  const globalsOffset = headerSize
  const treeOffset = globalsOffset + globals.length
  const tessellationOffset = treeOffset + tree.length
  const modelOffset = tessellationOffset + tessellation.length
  const end = modelOffset + model.length
  const header = [
    0x50, 0x52, 0x43,
    ...u32(8137), ...u32(8137),
    ...new Array<number>(16).fill(0), ...new Array<number>(16).fill(0),
    ...u32(1),
    ...new Array<number>(16).fill(0), ...u32(0), ...u32(6),
    ...u32(headerSize), ...u32(globalsOffset), ...u32(treeOffset), ...u32(tessellationOffset), ...u32(modelOffset), ...u32(modelOffset),
    ...u32(modelOffset), ...u32(end),
    ...u32(0),
  ]
  if (header.length !== headerSize) throw new Error('Invalid PRC test header size')
  return new Uint8Array([...header, ...globals, ...tree, ...tessellation, ...model])
}

/** ISO 14739-1 file containing one highly compressed, vertex-colored triangle. */
export function buildCompressedPrcFixture(): Uint8Array {
  return buildPrcFixtureWithTessellation(tessellationSection(true))
}

/** PRC scene with a product occurrence and local coordinate-system transforms. */
export function buildTransformedPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(transformedGlobalsSection(), transformedTreeSection(), tessellationSection(false))
}

/** PRC scene whose representation item uses a translucent global style. */
export function buildStyledPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(styledGlobalsSection(), transformedTreeSection(true), tessellationSection(false))
}

/** PRC scene whose active entity filter excludes the only representation item. */
export function buildFilteredPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(transformedGlobalsSection(), transformedTreeSection(false, true), tessellationSection(false))
}

/** PRC scene with an active scene-display camera. */
export function buildCameraPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(transformedGlobalsSection(), transformedTreeSection(false, false, true), tessellationSection(false))
}

/** PRC scene whose active scene-display parameters select a red background style. */
export function buildBackgroundPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(styledGlobalsSection(), transformedTreeSection(false, false, true, true), tessellationSection(false))
}

/** PRC scene containing a geometric markup tessellation. */
export function buildMarkupPrcFixture(): Uint8Array {
  return buildPrcFixtureWithTessellation(markupTessellationSection())
}

/** PRC scene whose part markup references a markup tessellation through the assembly tree. */
export function buildLinkedMarkupPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(globalsSection(), linkedMarkupTreeSection(), markupTessellationSection())
}

/** PRC scene containing markup color and line-width rendering state. */
export function buildStyledMarkupPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(styledGlobalsSection(), treeSection(), styledMarkupTessellationSection())
}

/** PRC scene with UV-mapped raw RGBA texture data. */
export function buildTexturedPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(texturedGlobalsSection(), transformedTreeSection(true), texturedTessellationSection(), [deflateSync(new Uint8Array([255, 0, 0, 255]))])
}

/** PRC scene with a material and an active ambient light. */
export function buildLitPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(materialGlobalsSection(), transformedTreeSection(true, false, false, false, 'light'), tessellationSection(false))
}

/** PRC scene whose active display state clips the triangle against a plane. */
export function buildClippedPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(materialGlobalsSection(), transformedTreeSection(true, false, false, false, 'clip'), tessellationSection(false))
}

/** PRC markup containing both text and an embedded raw RGBA picture. */
export function buildTextPictureMarkupPrcFixture(): Uint8Array {
  return buildPrcFixtureWithSections(markupResourceGlobalsSection(), treeSection(), textPictureMarkupTessellationSection(), [deflateSync(new Uint8Array([0, 255, 0, 255]))])
}

function buildPrcFixtureWithTessellation(tessellation: Uint8Array): Uint8Array {
  return buildPrcFixtureWithSections(globalsSection(), treeSection(), tessellation)
}

function buildPrcFixtureWithSections(globals: Uint8Array, tree: Uint8Array, tessellation: Uint8Array, files: Uint8Array[] = []): Uint8Array {
  const model = modelFile()
  const fileBytes = files.flatMap(function (file) { return [...u32(file.length), ...file] })
  const headerSize = 107 + fileBytes.length
  const globalsOffset = headerSize
  const treeOffset = globalsOffset + globals.length
  const tessellationOffset = treeOffset + tree.length
  const modelOffset = tessellationOffset + tessellation.length
  const end = modelOffset + model.length
  const header = [
    0x50, 0x52, 0x43,
    ...u32(8137), ...u32(8137),
    ...new Array<number>(16).fill(0), ...new Array<number>(16).fill(0),
    ...u32(1),
    ...new Array<number>(16).fill(0), ...u32(0), ...u32(6),
    ...u32(headerSize), ...u32(globalsOffset), ...u32(treeOffset), ...u32(tessellationOffset), ...u32(modelOffset), ...u32(modelOffset),
    ...u32(modelOffset), ...u32(end),
    ...u32(files.length), ...fileBytes,
  ]
  if (header.length !== headerSize) throw new Error('Invalid PRC test header size')
  return new Uint8Array([...header, ...globals, ...tree, ...tessellation, ...model])
}
