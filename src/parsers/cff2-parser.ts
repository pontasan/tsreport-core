/**
 * CFF2 (Compact Font Format 2) parser
 * Variable font support for OpenType 1.8+
 * CFF2 differs structurally from CFF1:
 * - No Name INDEX
 * - No String INDEX
 * - Top DICT is fixed-length data, not an INDEX
 * - Global Subr INDEX immediately follows the Header
 * - CharStrings are referenced via the charstrings operator in the Top DICT
 * - blend/vsindex operators (for variable fonts)
 */
import { BinaryReader } from '../binary/reader.js'
import { PathCommand } from '../types/glyph.js'
import type { GlyphOutline } from '../types/index.js'
import type { CffCharstringHints } from './cff-parser.js'
import { parseItemVariationStore, type ItemVariationStore } from './tables/variation-common.js'

// CFF2 INDEX structure (unlike CFF1, count is 4 bytes)
export interface Cff2Index {
  count: number
  offsets: Uint32Array
  data: BinaryReader
}

function parseIndex2(reader: BinaryReader): Cff2Index {
  if (reader.remaining < 4) throw new Error('CFF2 INDEX count is truncated')
  const count = reader.readUint32()
  if (count === 0) {
    return { count: 0, offsets: new Uint32Array(0), data: reader.subReader(reader.position, 0) }
  }

  const offSize = reader.readUint8()
  if (offSize < 1 || offSize > 4) throw new Error(`CFF2 INDEX offsetSize must be from 1 to 4, got ${offSize}`)
  if (count > Math.floor(reader.remaining / offSize) - 1) throw new Error('CFF2 INDEX offset array is truncated')
  const offsets = new Uint32Array(count + 1)

  for (let i = 0; i <= count; i++) {
    let offset = 0
    for (let j = 0; j < offSize; j++) {
      offset = (offset << 8) | reader.readUint8()
    }
    offsets[i] = offset
  }

  if (offsets[0] !== 1) throw new Error(`CFF2 INDEX first offset must be 1, got ${offsets[0]}`)
  for (let i = 1; i <= count; i++) {
    if (offsets[i]! < offsets[i - 1]!) throw new Error('CFF2 INDEX offsets must be nondecreasing')
  }

  const dataStart = reader.position
  const dataLength = offsets[count]! - 1
  if (dataLength > reader.remaining) throw new Error('CFF2 INDEX object data exceeds table length')
  const data = reader.subReader(dataStart, dataLength)
  reader.seek(dataStart + dataLength)

  return { count, offsets, data }
}

export function getCff2IndexEntry(index: Cff2Index, i: number): BinaryReader {
  const offset = index.offsets[i]! - 1
  const length = index.offsets[i + 1]! - index.offsets[i]!
  return index.data.subReader(offset, length)
}

// CFF2 DICT parsing (same format as CFF1)
interface Cff2Dict {
  entries: Map<number, number[]>
}

function parseDict2(
  reader: BinaryReader,
  variation?: { readonly store: Cff2ItemVariationStore, readonly coords: number[] },
  kind: 'top' | 'font' | 'private' = 'top',
): Cff2Dict {
  const entries = new Map<number, number[]>()
  const operands: number[] = []
  let vsIndex = 0

  while (reader.remaining > 0) {
    const b0 = reader.readUint8()

    if (kind === 'private' && b0 === 23) {
      if (variation === undefined) throw new Error('CFF2 PrivateDICT blend requires a VariationStore')
      const count = popBlendCount(operands)
      blendOperands(operands, count, getRegionScalars(variation.store, vsIndex, variation.coords))
    } else if (b0 === 12) {
      const b1 = reader.readUint8()
      const op = 1200 + b1
      if (!isCff2DictOperator(kind, op)) {
        operands.length = 0
        continue
      }
      validateCff2DictOperands(kind, op, operands)
      if (entries.has(op)) throw new Error(`CFF2 DICT operator ${op} is duplicated`)
      entries.set(op, [...operands])
      operands.length = 0
    } else if (b0 <= 24) {
      if (!isCff2DictOperator(kind, b0)) {
        operands.length = 0
        continue
      }
      validateCff2DictOperands(kind, b0, operands)
      if (entries.has(b0)) throw new Error(`CFF2 DICT operator ${b0} is duplicated`)
      entries.set(b0, [...operands])
      if (kind === 'private' && b0 === 22) {
        vsIndex = operands[0]!
      }
      operands.length = 0
    } else if (b0 === 28) {
      const hi = reader.readUint8()
      const lo = reader.readUint8()
      operands.push((hi << 8 | lo) << 16 >> 16)
    } else if (b0 === 29) {
      const b1 = reader.readUint8()
      const b2 = reader.readUint8()
      const b3 = reader.readUint8()
      const b4 = reader.readUint8()
      operands.push(((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) >> 0)
    } else if (b0 === 30) {
      operands.push(parseCff2Real(reader))
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139)
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + reader.readUint8() + 108)
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - reader.readUint8() - 108)
    }
  }
  if (operands.length !== 0) throw new Error('CFF2 DICT ends with operands that have no operator')
  return { entries }
}

function isCff2DictOperator(kind: 'top' | 'font' | 'private', operator: number): boolean {
  if (kind === 'top') return operator === 17 || operator === 24 || operator === 1207 || operator === 1236 || operator === 1237
  if (kind === 'font') return operator === 18
  return operator === 6 || operator === 7 || operator === 8 || operator === 9
    || operator === 10 || operator === 11 || operator === 19 || operator === 22
    || operator === 1209 || operator === 1210 || operator === 1211 || operator === 1212
    || operator === 1213 || operator === 1217 || operator === 1218
}

function validateCff2DictOperands(kind: 'top' | 'font' | 'private', operator: number, operands: number[]): void {
  const requireInteger = function (value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`)
  }
  if (kind === 'top') {
    if (operator === 1207) {
      if (operands.length !== 6 || operands[0] !== operands[3]
        || operands[1] !== 0 || operands[2] !== 0 || operands[4] !== 0 || operands[5] !== 0
        || operands[0]! <= 0) {
        throw new Error('CFF2 TopDICT FontMatrix must be [scale 0 0 scale 0 0] with positive scale')
      }
      return
    }
    if (operands.length !== 1) throw new Error(`CFF2 TopDICT operator ${operator} requires one operand`)
    requireInteger(operands[0]!, `CFF2 TopDICT operator ${operator} offset`)
    return
  }
  if (kind === 'font') {
    if (operands.length !== 2) throw new Error('CFF2 FontDICT Private operator requires size and offset operands')
    requireInteger(operands[0]!, 'CFF2 PrivateDICT size')
    requireInteger(operands[1]!, 'CFF2 PrivateDICT offset')
    if ((operands[0] === 0) !== (operands[1] === 0)) throw new Error('CFF2 empty PrivateDICT requires size and offset both zero')
    return
  }
  if (operator === 6 || operator === 7 || operator === 8 || operator === 9) {
    if (operands.length === 0) throw new Error(`CFF2 PrivateDICT operator ${operator} requires a deltaArray`)
  } else if (operator === 1212 || operator === 1213) {
    if (operands.length === 0 || operands.length > 12) throw new Error(`CFF2 PrivateDICT operator ${operator} requires 1 to 12 operands`)
  } else if (operands.length !== 1) {
    throw new Error(`CFF2 PrivateDICT operator ${operator} requires one operand`)
  }
  if (operator === 19 || operator === 22 || operator === 1217) {
    requireInteger(operands[0]!, `CFF2 PrivateDICT operator ${operator}`)
  }
  if ((operator === 10 || operator === 11) && operands[0]! < 0) {
    throw new Error(`CFF2 PrivateDICT operator ${operator} must be non-negative`)
  }
}

function parseCff2Real(reader: BinaryReader): number {
  let str = ''
  let done = false
  while (!done) {
    const byte = reader.readUint8()
    for (let shift = 4; shift >= 0; shift -= 4) {
      const nibble = (byte >> shift) & 0x0F
      if (nibble === 0x0F) { done = true; break }
      else if (nibble <= 9) str += String.fromCharCode(0x30 + nibble)
      else if (nibble === 0x0A) str += '.'
      else if (nibble === 0x0B) str += 'E'
      else if (nibble === 0x0C) str += 'E-'
      else if (nibble === 0x0D) throw new Error('CFF2 real number uses reserved nibble 0xD')
      else if (nibble === 0x0E) str += '-'
    }
  }
  if (str === '' || str === '.') return 0
  if (!/^-?(?:[1-9][0-9]*|0)?(?:\.[0-9]*)?(?:E-?[1-9][0-9]*)?$/.test(str) || !/[0-9.]/.test(str)) {
    throw new Error(`CFF2 real number is malformed: ${str}`)
  }
  return Number(str)
}

function calcSubrBias2(count: number): number {
  if (count < 1240) return 107
  if (count < 33900) return 1131
  return 32768
}

export type Cff2ItemVariationStore = ItemVariationStore

// CFF2 data
export interface Cff2Data {
  charstrings: Cff2Index
  globalSubrs: Cff2Index
  globalBias: number
  fdArray: Cff2FDData[]
  fdSelect: Uint8Array | null
  vstore: Cff2ItemVariationStore | null
  variationStoreReader: BinaryReader | null
  fontMatrix: number[] | null
}

export interface Cff2FDData {
  localSubrs: Cff2Index
  localBias: number
  /** PrivateDICT entries evaluated at the default variation coordinates. */
  privateDictEntries: Map<number, number[]>
  /** PrivateDICT vsindex inherited by associated CharStrings. */
  defaultVsIndex: number
  privateDictReader: BinaryReader
}

const EMPTY_OUTLINE: GlyphOutline = {
  commands: new Uint8Array(0),
  coords: new Float32Array(0),
}

function parseCff2ItemVariationStore(reader: BinaryReader, offset: number, expectedAxisCount?: number): Cff2ItemVariationStore {
  if (offset < 0 || offset + 2 > reader.length) {
    throw new Error(`CFF2 VariationStore length field exceeds table length: ${offset}`)
  }
  reader.seek(offset)
  const length = reader.readUint16()
  if (length === 0) {
    throw new Error('CFF2 VariationStore length must be greater than zero')
  }
  const storeStart = offset + 2
  if (storeStart + length > reader.length) {
    throw new Error(`CFF2 VariationStore data exceeds table length: length ${length}`)
  }
  const storeReader = reader.subReader(storeStart, length)
  validateCff2VariationDataHeaders(storeReader)
  return parseItemVariationStore(storeReader, 0, expectedAxisCount)
}

function validateCff2VariationDataHeaders(reader: BinaryReader): void {
  if (reader.length < 8) throw new Error('CFF2 VariationStore header is truncated')
  const count = reader.getUint16At(6)
  if (8 + count * 4 > reader.length) throw new Error('CFF2 VariationStore data offset array is truncated')
  for (let i = 0; i < count; i++) {
    const offset = reader.getUint32At(8 + i * 4)
    if (offset === 0 || offset + 4 > reader.length) continue
    const itemCount = reader.getUint16At(offset)
    const wordDeltaCount = reader.getUint16At(offset + 2)
    if (itemCount !== 0 || wordDeltaCount !== 0) {
      throw new Error(`CFF2 ItemVariationData ${i} itemCount and wordDeltaCount must be zero`)
    }
  }
}

function getRegionScalars(vstore: Cff2ItemVariationStore, vsIndex: number, coords: number[]): number[] {
  if (vsIndex < 0 || vsIndex >= vstore.data.length) throw new Error(`CFF2 vsindex ${vsIndex} exceeds VariationStore data count`)
  const ivd = vstore.data[vsIndex]!
  const scalars: number[] = []
  for (const regionIdx of ivd.regionIndices) {
    const region = vstore.regions[regionIdx]
    if (!region) { scalars.push(0); continue }
    let scalar = 1.0
    for (let a = 0; a < region.axes.length; a++) {
      const { startCoord, peakCoord, endCoord } = region.axes[a]!
      const coord = coords[a] ?? 0
      if (peakCoord === 0) continue
      if (coord < startCoord || coord > endCoord) { scalar = 0; break }
      if (coord === peakCoord) continue
      if (coord < peakCoord) {
        scalar *= (peakCoord === startCoord) ? 1 : (coord - startCoord) / (peakCoord - startCoord)
      } else {
        scalar *= (peakCoord === endCoord) ? 1 : (endCoord - coord) / (endCoord - peakCoord)
      }
    }
    scalars.push(scalar)
  }
  return scalars
}

function popBlendCount(stack: number[]): number {
  const count = stack.pop()
  if (count === undefined || !Number.isInteger(count) || count < 0) throw new Error('CFF2 blend count must be a non-negative integer')
  return count
}

function blendOperands(stack: number[], count: number, scalars: readonly number[]): void {
  const argumentCount = count * (scalars.length + 1)
  if (argumentCount > stack.length) throw new Error('CFF2 blend operands underflow the argument stack')
  const base = stack.length - argumentCount
  for (let valueIndex = 0; valueIndex < count; valueIndex++) {
    let value = stack[base + valueIndex]!
    for (let regionIndex = 0; regionIndex < scalars.length; regionIndex++) {
      value += stack[base + count + valueIndex * scalars.length + regionIndex]! * scalars[regionIndex]!
    }
    stack[base + valueIndex] = value
  }
  stack.length = base + count
}

/**
 * Parses the CFF2 table
 */
export function parseCff2(reader: BinaryReader, expectedAxisCount?: number): Cff2Data {
  // CFF2 Header
  if (reader.remaining < 5) throw new Error('CFF2 header is truncated')
  const majorVersion = reader.readUint8() // 2
  const minorVersion = reader.readUint8()
  const headerSize = reader.readUint8()
  const topDictLength = reader.readUint16()
  if (majorVersion !== 2) throw new Error(`Unsupported CFF2 major version: ${majorVersion}.${minorVersion}`)
  if (headerSize < 5 || headerSize > reader.length) throw new Error(`CFF2 header size ${headerSize} is invalid`)
  if (minorVersion === 0 && headerSize !== 5) throw new Error(`CFF2 version 2.0 header size must be 5, got ${headerSize}`)
  if (topDictLength > reader.length - headerSize) throw new Error('CFF2 Top DICT exceeds table length')

  // Top DICT (topDictLength bytes starting at headerSize)
  reader.seek(headerSize)
  const topDictReader = reader.subReader(reader.position, topDictLength)
  const topDict = parseDict2(topDictReader)
  if (!topDict.entries.has(17)) throw new Error('CFF2 TopDICT requires CharStringINDEXOffset')
  if (!topDict.entries.has(1236)) throw new Error('CFF2 TopDICT requires FontDICTINDEXOffset')
  reader.seek(headerSize + topDictLength)

  // Global Subr INDEX (immediately after the Top DICT)
  const globalSubrs = parseIndex2(reader)
  const globalBias = calcSubrBias2(globalSubrs.count)

  // CharStrings INDEX
  const charstringsOffset = topDict.entries.get(17)?.[0] ?? 0 // op 17 = CharStrings
  reader.seek(charstringsOffset)
  const charstrings = parseIndex2(reader)
  const numGlyphs = charstrings.count

  // The VariationStore is needed while decoding variable PrivateDICT values.
  let vstore: Cff2ItemVariationStore | null = null
  let variationStoreReader: BinaryReader | null = null
  const vstoreOffset = topDict.entries.get(24)?.[0]
  if (vstoreOffset !== undefined) {
    if (expectedAxisCount === undefined) throw new Error("CFF2 VariationStore requires table 'fvar'")
    vstore = parseCff2ItemVariationStore(reader, vstoreOffset, expectedAxisCount)
    const variationStoreLength = reader.getUint16At(vstoreOffset)
    variationStoreReader = reader.subReader(vstoreOffset, variationStoreLength + 2)
  }
  const defaultCoords = new Array<number>(expectedAxisCount ?? 0).fill(0)

  // FDSelect
  let fdSelect: Uint8Array | null = null
  const fdSelectOffset = topDict.entries.get(1237)?.[0] // 12 37
  if (fdSelectOffset !== undefined) {
    reader.seek(fdSelectOffset)
    const format = reader.readUint8()
    fdSelect = new Uint8Array(numGlyphs)

    if (format === 0) {
      for (let i = 0; i < numGlyphs; i++) {
        fdSelect[i] = reader.readUint8()
      }
    } else if (format === 3) {
      const nRanges = reader.readUint16()
      if (nRanges === 0) throw new Error('CFF2 FontDICTSelect format 3 requires at least one range')
      let first = reader.readUint16()
      if (first !== 0) throw new Error('CFF2 FontDICTSelect first range must start at glyph 0')
      for (let i = 0; i < nRanges; i++) {
        const fd = reader.readUint8()
        const next = reader.readUint16()
        if (next <= first) throw new Error('CFF2 FontDICTSelect ranges must be strictly increasing')
        if (next > numGlyphs) throw new Error('CFF2 FontDICTSelect range exceeds CharString count')
        for (let g = first; g < next; g++) fdSelect[g] = fd
        first = next
      }
      if (first !== numGlyphs) throw new Error('CFF2 FontDICTSelect sentinel must equal CharString count')
    } else if (format === 4) {
      const nRanges = reader.readUint32()
      if (nRanges === 0) throw new Error('CFF2 FontDICTSelect format 4 requires at least one range')
      let first = reader.readUint32()
      if (first !== 0) throw new Error('CFF2 FontDICTSelect first range must start at glyph 0')
      for (let i = 0; i < nRanges; i++) {
        const fd = reader.readUint16()
        const next = reader.readUint32()
        if (next <= first) throw new Error('CFF2 FontDICTSelect ranges must be strictly increasing')
        if (next > numGlyphs) throw new Error('CFF2 FontDICTSelect range exceeds CharString count')
        for (let g = first; g < next; g++) fdSelect[g] = fd
        first = next
      }
      if (first !== numGlyphs) throw new Error('CFF2 FontDICTSelect sentinel must equal CharString count')
    } else {
      throw new Error(`Unsupported CFF2 FontDICTSelect format: ${format}`)
    }
  }

  // FDArray INDEX
  const fdArray: Cff2FDData[] = []
  const fdArrayOffset = topDict.entries.get(1236)?.[0] // 12 36
  if (fdArrayOffset !== undefined) {
    reader.seek(fdArrayOffset)
    const fdArrayIndex = parseIndex2(reader)
    if (fdArrayIndex.count === 0) throw new Error('CFF2 FontDICTINDEX must contain at least one FontDICT')

    for (let i = 0; i < fdArrayIndex.count; i++) {
      const fdDictReader = getCff2IndexEntry(fdArrayIndex, i)
      const fdDict = parseDict2(fdDictReader, undefined, 'font')

      let localSubrs: Cff2Index = { count: 0, offsets: new Uint32Array(0), data: reader.subReader(0, 0) }
      let localBias = 0
      let privateDictEntries = new Map<number, number[]>()
      let defaultVsIndex = 0
      let privateDictReader = reader.subReader(0, 0)

      const privArr = fdDict.entries.get(18) // op 18 = Private
      if (privArr === undefined) throw new Error('CFF2 FontDICT requires a PrivateDICT offset')
      if (privArr[0] !== 0) {
        const privSize = privArr[0]!
        const privOffset = privArr[1]!
        privateDictReader = reader.subReader(privOffset, privSize)
        const privDict = parseDict2(
          privateDictReader.subReader(0, privateDictReader.length),
          vstore === null ? undefined : { store: vstore, coords: defaultCoords },
          'private',
        )
        privateDictEntries = privDict.entries
        defaultVsIndex = privDict.entries.get(22)?.[0] ?? 0
        if (vstore !== null && defaultVsIndex >= vstore.data.length) throw new Error(`CFF2 PrivateDICT vsindex ${defaultVsIndex} exceeds VariationStore data count`)

        const subrsOff = privDict.entries.get(19)?.[0]
        if (subrsOff !== undefined) {
          reader.seek(privOffset + subrsOff)
          localSubrs = parseIndex2(reader)
          localBias = calcSubrBias2(localSubrs.count)
        }
      }

      fdArray.push({ localSubrs, localBias, privateDictEntries, defaultVsIndex, privateDictReader })
    }
  }

  if (fdSelect === null && fdArray.length !== 1) throw new Error('CFF2 with multiple FontDICTs requires FontDICTSelect')
  if (fdSelect !== null && fdArray.length === 1) throw new Error('CFF2 with one FontDICT must omit FontDICTSelect')
  if (fdSelect !== null) {
    for (let glyphId = 0; glyphId < fdSelect.length; glyphId++) {
      if (fdSelect[glyphId]! >= fdArray.length) throw new Error(`CFF2 FontDICTSelect glyph ${glyphId} exceeds FontDICT count`)
    }
  }

  const fontMatrix = topDict.entries.get(1207) ?? null
  return { charstrings, globalSubrs, globalBias, fdArray, fdSelect, vstore, variationStoreReader, fontMatrix }
}

/** Evaluates the selected glyph's variable PrivateDICT at an instance. */
export function getCff2PrivateDictEntries(cff2: Cff2Data, glyphId: number, coords: number[]): Map<number, number[]> {
  const fdIndex = cff2.fdSelect?.[glyphId] ?? 0
  const fd = cff2.fdArray[fdIndex]
  if (fd === undefined) throw new Error(`CFF2 FDSelect index ${fdIndex} exceeds FontDICT count`)
  if (fd.privateDictReader.length === 0) return new Map()
  return parseDict2(
    fd.privateDictReader.subReader(0, fd.privateDictReader.length),
    cff2.vstore === null ? undefined : { store: cff2.vstore, coords },
    'private',
  ).entries
}

/**
 * Gets a CFF2 glyph outline
 */
function interpretCff2Glyph(
  cff2: Cff2Data, glyphId: number, normalizedCoords?: number[] | null,
  captureHints = false,
): { outline: GlyphOutline, width: number, hints?: CffCharstringHints } {
  if (glyphId >= cff2.charstrings.count) {
    return {
      outline: EMPTY_OUTLINE,
      width: 0,
      ...(captureHints ? { hints: { hStems: [], vStems: [], hintMasks: [], counterMasks: [] } } : {}),
    }
  }

  // FD selection
  const fdIdx = cff2.fdSelect ? cff2.fdSelect[glyphId]! : 0
  const fd = cff2.fdArray[fdIdx] ?? cff2.fdArray[0]!

  const charstring = getCff2IndexEntry(cff2.charstrings, glyphId)

  // CFF2 charstring interpreter
  // Note: CFF2 does NOT use width-from-charstring (defaultWidthX/nominalWidthX).
  // Width comes from hmtx table. endchar is allowed but is a no-op.
  const commands: number[] = []
  const coords: number[] = []
  const stack: number[] = []
  let x = 0, y = 0
  let nStems = 0
  let currentVsIndex = fd.defaultVsIndex
  let open = false
  const hStems: CffCharstringHints['hStems'] = []
  const vStems: CffCharstringHints['vStems'] = []
  const hintMasks: Uint8Array[] = []
  const counterMasks: Uint8Array[] = []
  let hStemPos = 0
  let vStemPos = 0
  let pathStarted = false

  // The Type 2 charstring spec (section 4.3) caps subroutine nesting at 10.
  // Enforcing it stops a self-referential subr from recursing until the JS call
  // stack overflows.
  const MAX_SUBR_DEPTH = 10

  function requireOperands(operator: string, minimum: number, modulo?: number, remainder = 0): void {
    if (stack.length < minimum || (modulo !== undefined && stack.length % modulo !== remainder)) {
      throw new Error(`CFF2 ${operator} has invalid operand count ${stack.length}`)
    }
  }

  function pushOperand(value: number): void {
    if (stack.length >= 513) throw new Error('CFF2 CharString operand stack exceeds 513 values')
    stack.push(value)
  }

  function execute(csReader: BinaryReader, depth: number) {
    while (csReader.remaining > 0) {
      const b0 = csReader.readUint8()

      if (b0 === 10) { // callsubr
        requireOperands('callsubr', 1)
        const operand = stack.pop()!
        if (!Number.isInteger(operand)) throw new Error('CFF2 callsubr operand must be an integer')
        const idx = operand + fd.localBias
        if (idx < 0 || idx >= fd.localSubrs.count) throw new Error(`CFF2 callsubr index ${idx} exceeds LocalSubrINDEX`)
        if (depth >= MAX_SUBR_DEPTH) throw new Error('CFF2 subroutine nesting depth exceeded (max ' + MAX_SUBR_DEPTH + ')')
        execute(getCff2IndexEntry(fd.localSubrs, idx), depth + 1)
        continue
      }

      if (b0 === 29) { // callgsubr
        requireOperands('callgsubr', 1)
        const operand = stack.pop()!
        if (!Number.isInteger(operand)) throw new Error('CFF2 callgsubr operand must be an integer')
        const idx = operand + cff2.globalBias
        if (idx < 0 || idx >= cff2.globalSubrs.count) throw new Error(`CFF2 callgsubr index ${idx} exceeds GlobalSubrINDEX`)
        if (depth >= MAX_SUBR_DEPTH) throw new Error('CFF2 subroutine nesting depth exceeded (max ' + MAX_SUBR_DEPTH + ')')
        execute(getCff2IndexEntry(cff2.globalSubrs, idx), depth + 1)
        continue
      }

      if (b0 === 11) {
        if (depth === 0) throw new Error('CFF2 return is only valid in a subroutine')
        return
      }

      // Number encoding
      if (b0 >= 32 && b0 <= 246) { pushOperand(b0 - 139); continue }
      if (b0 >= 247 && b0 <= 250) { pushOperand((b0 - 247) * 256 + csReader.readUint8() + 108); continue }
      if (b0 >= 251 && b0 <= 254) { pushOperand(-(b0 - 251) * 256 - csReader.readUint8() - 108); continue }
      if (b0 === 28) { const hi = csReader.readUint8(); const lo = csReader.readUint8(); pushOperand((hi << 8 | lo) << 16 >> 16); continue }
      if (b0 === 255) {
        // CFF2: 16.16 fixed point
        const hi = csReader.readInt16()
        const lo = csReader.readUint16()
        pushOperand(hi + lo / 65536)
        continue
      }

      // Path operators — CFF2: no width operand in moveto
      if (b0 === 21) { // rmoveto
        requireOperands('rmoveto', 2, 2)
        if (stack.length !== 2) throw new Error('CFF2 rmoveto requires exactly two operands')
        if (open) { commands.push(PathCommand.Close); open = false }
        const dy = stack.pop()!; const dx = stack.pop()!
        x += dx; y += dy
        commands.push(PathCommand.MoveTo)
        coords.push(x, y)
        open = true
        pathStarted = true
        stack.length = 0
      } else if (b0 === 22) { // hmoveto
        if (stack.length !== 1) throw new Error('CFF2 hmoveto requires exactly one operand')
        if (open) { commands.push(PathCommand.Close); open = false }
        x += stack.pop()!
        commands.push(PathCommand.MoveTo)
        coords.push(x, y)
        open = true
        pathStarted = true
        stack.length = 0
      } else if (b0 === 4) { // vmoveto
        if (stack.length !== 1) throw new Error('CFF2 vmoveto requires exactly one operand')
        if (open) { commands.push(PathCommand.Close); open = false }
        y += stack.pop()!
        commands.push(PathCommand.MoveTo)
        coords.push(x, y)
        open = true
        pathStarted = true
        stack.length = 0
      } else if (b0 === 5) { // rlineto
        requireOperands('rlineto', 2, 2)
        for (let i = 0; i < stack.length; i += 2) {
          x += stack[i]!; y += stack[i + 1]!
          commands.push(PathCommand.LineTo)
          coords.push(x, y)
        }
        stack.length = 0
      } else if (b0 === 6) { // hlineto
        requireOperands('hlineto', 1)
        for (let i = 0; i < stack.length; i++) {
          if (i % 2 === 0) x += stack[i]!; else y += stack[i]!
          commands.push(PathCommand.LineTo)
          coords.push(x, y)
        }
        stack.length = 0
      } else if (b0 === 7) { // vlineto
        requireOperands('vlineto', 1)
        for (let i = 0; i < stack.length; i++) {
          if (i % 2 === 0) y += stack[i]!; else x += stack[i]!
          commands.push(PathCommand.LineTo)
          coords.push(x, y)
        }
        stack.length = 0
      } else if (b0 === 8) { // rrcurveto
        requireOperands('rrcurveto', 6, 6)
        for (let i = 0; i < stack.length; i += 6) {
          const x1 = x + stack[i]!, y1 = y + stack[i + 1]!
          const x2 = x1 + stack[i + 2]!, y2 = y1 + stack[i + 3]!
          x = x2 + stack[i + 4]!; y = y2 + stack[i + 5]!
          commands.push(PathCommand.CubicTo)
          coords.push(x1, y1, x2, y2, x, y)
        }
        stack.length = 0
      } else if (b0 === 1 || b0 === 3 || b0 === 18 || b0 === 23) {
        // hstem, vstem, hstemhm, vstemhm — CFF2: no width operand
        if (pathStarted) throw new Error('CFF2 stem operators must precede path operators')
        if (stack.length === 0 || stack.length % 2 !== 0) throw new Error(`CFF2 stem operator ${b0} requires one or more operand pairs`)
        if (captureHints) {
          const horizontal = b0 === 1 || b0 === 18
          let position = horizontal ? hStemPos : vStemPos
          const destination = horizontal ? hStems : vStems
          for (let i = 0; i < stack.length; i += 2) {
            position += stack[i]!
            const width = stack[i + 1]!
            destination.push({ pos: position, width })
            position += width
          }
          if (horizontal) hStemPos = position
          else vStemPos = position
        }
        nStems += stack.length >> 1
        stack.length = 0
      } else if (b0 === 19 || b0 === 20) {
        // hintmask, cntrmask — CFF2: no width operand
        if (pathStarted && b0 === 20) throw new Error('CFF2 cntrmask must precede path operators')
        if (stack.length % 2 !== 0) throw new Error(`CFF2 mask operator ${b0} requires stem operand pairs`)
        if (captureHints && stack.length > 0) {
          let position = vStemPos
          for (let i = 0; i < stack.length; i += 2) {
            position += stack[i]!
            const width = stack[i + 1]!
            vStems.push({ pos: position, width })
            position += width
          }
          vStemPos = position
        }
        nStems += stack.length >> 1
        stack.length = 0
        const maskLength = Math.ceil(nStems / 8)
        if (maskLength === 0) throw new Error(`CFF2 mask operator ${b0} requires at least one stem`)
        if (maskLength > csReader.remaining) throw new Error(`CFF2 mask operator ${b0} data is truncated`)
        if (captureHints) {
          const mask = csReader.readBytes(maskLength)
          if (b0 === 19) hintMasks.push(mask)
          else counterMasks.push(mask)
        } else {
          csReader.skip(maskLength)
        }
      } else if (b0 === 27) { // hhcurveto
        requireOperands('hhcurveto', 4, 4, stack.length % 4)
        if (stack.length % 4 > 1) throw new Error(`CFF2 hhcurveto has invalid operand count ${stack.length}`)
        let i = 0
        if (stack.length % 4 === 1) {
          const y1 = y + stack[i++]!
          const x1 = x + stack[i++]!
          const x2 = x1 + stack[i++]!, y2 = y1 + stack[i++]!
          x = x2 + stack[i++]!; y = y2
          commands.push(PathCommand.CubicTo)
          coords.push(x1, y1, x2, y2, x, y)
        }
        while (i < stack.length) {
          const x1 = x + stack[i++]!, y1 = y
          const x2 = x1 + stack[i++]!, y2 = y1 + stack[i++]!
          x = x2 + stack[i++]!; y = y2
          commands.push(PathCommand.CubicTo)
          coords.push(x1, y1, x2, y2, x, y)
        }
        stack.length = 0
      } else if (b0 === 26) { // vvcurveto
        if (stack.length < 4 || stack.length % 4 > 1) throw new Error(`CFF2 vvcurveto has invalid operand count ${stack.length}`)
        let i = 0
        if (stack.length % 4 === 1) {
          const x1 = x + stack[i++]!
          const y1 = y + stack[i++]!
          const x2 = x1 + stack[i++]!, y2 = y1 + stack[i++]!
          x = x2; y = y2 + stack[i++]!
          commands.push(PathCommand.CubicTo)
          coords.push(x1, y1, x2, y2, x, y)
        }
        while (i < stack.length) {
          const x1 = x, y1 = y + stack[i++]!
          const x2 = x1 + stack[i++]!, y2 = y1 + stack[i++]!
          x = x2; y = y2 + stack[i++]!
          commands.push(PathCommand.CubicTo)
          coords.push(x1, y1, x2, y2, x, y)
        }
        stack.length = 0
      } else if (b0 === 31) { // hvcurveto
        if (stack.length < 4 || (stack.length % 4 !== 0 && stack.length % 4 !== 1)) throw new Error(`CFF2 hvcurveto has invalid operand count ${stack.length}`)
        let i = 0
        let isH = true
        while (i + 3 < stack.length) {
          if (isH) {
            const x1 = x + stack[i++]!, y1 = y
            const x2 = x1 + stack[i++]!, y2 = y1 + stack[i++]!
            x = x2; y = y2 + stack[i++]!
            if (i === stack.length - 1) x += stack[i++]!
            commands.push(PathCommand.CubicTo)
            coords.push(x1, y1, x2, y2, x, y)
          } else {
            const x1 = x, y1 = y + stack[i++]!
            const x2 = x1 + stack[i++]!, y2 = y1 + stack[i++]!
            x = x2 + stack[i++]!; y = y2
            if (i === stack.length - 1) y += stack[i++]!
            commands.push(PathCommand.CubicTo)
            coords.push(x1, y1, x2, y2, x, y)
          }
          isH = !isH
        }
        stack.length = 0
      } else if (b0 === 30) { // vhcurveto
        if (stack.length < 4 || (stack.length % 4 !== 0 && stack.length % 4 !== 1)) throw new Error(`CFF2 vhcurveto has invalid operand count ${stack.length}`)
        let i = 0
        let isV = true
        while (i + 3 < stack.length) {
          if (isV) {
            const x1 = x, y1 = y + stack[i++]!
            const x2 = x1 + stack[i++]!, y2 = y1 + stack[i++]!
            x = x2 + stack[i++]!; y = y2
            if (i === stack.length - 1) y += stack[i++]!
            commands.push(PathCommand.CubicTo)
            coords.push(x1, y1, x2, y2, x, y)
          } else {
            const x1 = x + stack[i++]!, y1 = y
            const x2 = x1 + stack[i++]!, y2 = y1 + stack[i++]!
            x = x2; y = y2 + stack[i++]!
            if (i === stack.length - 1) x += stack[i++]!
            commands.push(PathCommand.CubicTo)
            coords.push(x1, y1, x2, y2, x, y)
          }
          isV = !isV
        }
        stack.length = 0
      } else if (b0 === 24) { // rcurveline
        if (stack.length < 8 || (stack.length - 2) % 6 !== 0) throw new Error(`CFF2 rcurveline has invalid operand count ${stack.length}`)
        let i = 0
        while (i + 5 < stack.length - 1) {
          const x1 = x + stack[i++]!, y1 = y + stack[i++]!
          const x2 = x1 + stack[i++]!, y2 = y1 + stack[i++]!
          x = x2 + stack[i++]!; y = y2 + stack[i++]!
          commands.push(PathCommand.CubicTo)
          coords.push(x1, y1, x2, y2, x, y)
        }
        x += stack[i++]!; y += stack[i++]!
        commands.push(PathCommand.LineTo)
        coords.push(x, y)
        stack.length = 0
      } else if (b0 === 25) { // rlinecurve
        if (stack.length < 8 || (stack.length - 6) % 2 !== 0) throw new Error(`CFF2 rlinecurve has invalid operand count ${stack.length}`)
        let i = 0
        while (i + 7 < stack.length) {
          x += stack[i++]!; y += stack[i++]!
          commands.push(PathCommand.LineTo)
          coords.push(x, y)
        }
        const x1 = x + stack[i++]!, y1 = y + stack[i++]!
        const x2 = x1 + stack[i++]!, y2 = y1 + stack[i++]!
        x = x2 + stack[i++]!; y = y2 + stack[i++]!
        commands.push(PathCommand.CubicTo)
        coords.push(x1, y1, x2, y2, x, y)
        stack.length = 0
      } else if (b0 === 15) {
        // vsindex — CFF2 single-byte operator: select variation store subtable
        if (stack.length !== 1 || !Number.isInteger(stack[0]) || stack[0]! < 0) throw new Error('CFF2 vsindex requires one non-negative integer')
        if (cff2.vstore === null || stack[0]! >= cff2.vstore.data.length) throw new Error(`CFF2 vsindex ${stack[0]} exceeds VariationStore data count`)
        currentVsIndex = stack.pop()!
      } else if (b0 === 16) {
        // blend — CFF2 single-byte operator: apply variation deltas
        const n = popBlendCount(stack)
        if (cff2.vstore === null) throw new Error('CFF2 blend requires a VariationStore')
        const scalars = getRegionScalars(cff2.vstore, currentVsIndex, normalizedCoords ?? [])
        blendOperands(stack, n, scalars)
      } else if (b0 === 12) {
        // Escape
        const b1 = csReader.readUint8()
        if (b1 === 34) { // hflex
          if (stack.length !== 7) throw new Error('CFF2 hflex requires seven operands')
          const x1 = x + stack[0]!, y1 = y
          const x2 = x1 + stack[1]!, y2 = y1 + stack[2]!
          const x3 = x2 + stack[3]!, y3 = y2
          const x4 = x3 + stack[4]!, y4 = y3
          const x5 = x4 + stack[5]!, y5 = y
          x = x5 + stack[6]!
          commands.push(PathCommand.CubicTo); coords.push(x1, y1, x2, y2, x3, y3)
          commands.push(PathCommand.CubicTo); coords.push(x4, y4, x5, y5, x, y)
          stack.length = 0
        } else if (b1 === 35) { // flex
          if (stack.length !== 13) throw new Error('CFF2 flex requires thirteen operands')
          const x1 = x + stack[0]!, y1 = y + stack[1]!
          const x2 = x1 + stack[2]!, y2 = y1 + stack[3]!
          const x3 = x2 + stack[4]!, y3 = y2 + stack[5]!
          const x4 = x3 + stack[6]!, y4 = y3 + stack[7]!
          const x5 = x4 + stack[8]!, y5 = y4 + stack[9]!
          x = x5 + stack[10]!; y = y5 + stack[11]!
          commands.push(PathCommand.CubicTo); coords.push(x1, y1, x2, y2, x3, y3)
          commands.push(PathCommand.CubicTo); coords.push(x4, y4, x5, y5, x, y)
          stack.length = 0
        } else if (b1 === 36) { // hflex1
          if (stack.length !== 9) throw new Error('CFF2 hflex1 requires nine operands')
          const startY = y
          const x1 = x + stack[0]!, y1 = y + stack[1]!
          const x2 = x1 + stack[2]!, y2 = y1 + stack[3]!
          const x3 = x2 + stack[4]!, y3 = y2
          const x4 = x3 + stack[5]!, y4 = y3
          const x5 = x4 + stack[6]!, y5 = y4 + stack[7]!
          x = x5 + stack[8]!; y = startY
          commands.push(PathCommand.CubicTo); coords.push(x1, y1, x2, y2, x3, y3)
          commands.push(PathCommand.CubicTo); coords.push(x4, y4, x5, y5, x, y)
          stack.length = 0
        } else if (b1 === 37) { // flex1
          if (stack.length !== 11) throw new Error('CFF2 flex1 requires eleven operands')
          const x1 = x + stack[0]!, y1 = y + stack[1]!
          const x2 = x1 + stack[2]!, y2 = y1 + stack[3]!
          const x3 = x2 + stack[4]!, y3 = y2 + stack[5]!
          const x4 = x3 + stack[6]!, y4 = y3 + stack[7]!
          const x5 = x4 + stack[8]!, y5 = y4 + stack[9]!
          const d = stack[10]!
          if (Math.abs(x5 - x) > Math.abs(y5 - y)) { x = x5 + d; } else { y = y5 + d; }
          commands.push(PathCommand.CubicTo); coords.push(x1, y1, x2, y2, x3, y3)
          commands.push(PathCommand.CubicTo); coords.push(x4, y4, x5, y5, x, y)
          stack.length = 0
        } else {
          // Unrecognized operators are ignored and clear the stack.
          stack.length = 0
        }
      } else {
        // CFF2 specifies that unrecognized CharString operators are ignored.
        stack.length = 0
      }
    }
  }

  execute(charstring, 0)

  // Safety: close any open path if charstring ended without endchar
  if (open) {
    commands.push(PathCommand.Close)
  }

  return {
    outline: {
      commands: new Uint8Array(commands),
      coords: new Float32Array(coords),
    },
    width: 0, // CFF2: width comes from hmtx, not charstring
    ...(captureHints ? { hints: { hStems, vStems, hintMasks, counterMasks } } : {}),
  }
}

/** Gets a CFF2 glyph outline at normalized variation coordinates. */
export function parseCff2Glyph(
  cff2: Cff2Data, glyphId: number, normalizedCoords?: number[] | null,
): { outline: GlyphOutline, width: number } {
  return interpretCff2Glyph(cff2, glyphId, normalizedCoords)
}

/** Gets a CFF2 glyph outline and the hint data selected for its variation instance. */
export function parseCff2GlyphWithHints(
  cff2: Cff2Data, glyphId: number, normalizedCoords: number[],
): { outline: GlyphOutline, width: number, hints: CffCharstringHints, privateDictEntries: Map<number, number[]> } {
  const result = interpretCff2Glyph(cff2, glyphId, normalizedCoords, true)
  return {
    outline: result.outline,
    width: result.width,
    hints: result.hints!,
    privateDictEntries: getCff2PrivateDictEntries(cff2, glyphId, normalizedCoords),
  }
}
