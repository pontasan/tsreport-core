import { BinaryReader } from '../../binary/reader.js'

const FVAR_HEADER_SIZE = 16
const FVAR_MAJOR_VERSION = 1
const FVAR_MINOR_VERSION = 0
const FVAR_COUNT_SIZE_PAIRS = 2
const FVAR_AXIS_SIZE = 20
const FVAR_AXIS_FLAG_HIDDEN = 0x0001

/**
 * fvar table: Font Variations
 * Defines variation axes and named instances
 */

export interface VariationAxis {
  readonly tag: string           // axis tag (wght, wdth, ital, slnt, opsz, etc.)
  readonly minValue: number      // axis minimum value
  readonly defaultValue: number  // axis default value
  readonly maxValue: number      // axis maximum value
  readonly flags: number
  readonly axisNameId: number    // ID in the name table
}

export interface NamedInstance {
  readonly subfamilyNameId: number
  readonly flags: number
  readonly coordinates: Map<string, number>  // tag → value
  readonly postScriptNameId?: number
}

export interface FvarTable {
  readonly axes: VariationAxis[]
  readonly instances: NamedInstance[]
  /** Returns the index for an axis tag (-1 = not found) */
  getAxisIndex(tag: string): number
}

export function parseFvar(reader: BinaryReader): FvarTable {
  if (reader.length < FVAR_HEADER_SIZE) {
    throw new Error(`fvar table length must be at least ${FVAR_HEADER_SIZE}, got ${reader.length}`)
  }
  const majorVersion = reader.readUint16()
  const minorVersion = reader.readUint16()
  if (majorVersion !== FVAR_MAJOR_VERSION) {
    throw new Error(`Unsupported fvar table version: ${majorVersion}.${minorVersion}`)
  }
  const axesArrayOffset = reader.readUint16()
  const countSizePairs = reader.readUint16()
  if (minorVersion <= FVAR_MINOR_VERSION && countSizePairs !== FVAR_COUNT_SIZE_PAIRS) {
    throw new Error(`fvar countSizePairs must be ${FVAR_COUNT_SIZE_PAIRS}, got ${countSizePairs}`)
  }
  const axisCount = reader.readUint16()
  const axisSize = reader.readUint16()
  const instanceCount = reader.readUint16()
  const instanceSize = reader.readUint16()
  if (axisCount === 0) {
    throw new Error('fvar axisCount must be greater than 0')
  }
  if (axisSize < FVAR_AXIS_SIZE || (minorVersion <= FVAR_MINOR_VERSION && axisSize !== FVAR_AXIS_SIZE)) {
    throw new Error(`fvar axisSize must be at least ${FVAR_AXIS_SIZE}, got ${axisSize}`)
  }
  const instanceSizeWithoutPostScriptName = 4 + axisCount * 4
  const instanceSizeWithPostScriptName = instanceSizeWithoutPostScriptName + 2
  if (instanceSize < instanceSizeWithoutPostScriptName || (minorVersion <= FVAR_MINOR_VERSION && instanceSize !== instanceSizeWithoutPostScriptName && instanceSize !== instanceSizeWithPostScriptName)) {
    throw new Error(`fvar instanceSize must contain at least ${instanceSizeWithoutPostScriptName} bytes, got ${instanceSize}`)
  }
  if (axesArrayOffset < FVAR_HEADER_SIZE || axesArrayOffset > reader.length) {
    throw new Error(`fvar axesArrayOffset must be within the table, got ${axesArrayOffset}`)
  }
  const axesEnd = axesArrayOffset + axisCount * axisSize
  if (axesEnd > reader.length) {
    throw new Error(`fvar axes array exceeds table length: need ${axesEnd}, got ${reader.length}`)
  }
  const instancesEnd = axesEnd + instanceCount * instanceSize
  if (instancesEnd > reader.length || (minorVersion <= FVAR_MINOR_VERSION && instancesEnd !== reader.length)) {
    throw new Error(`fvar table length must contain exactly ${instancesEnd} known-version bytes (or at least that many for a future minor), got ${reader.length}`)
  }

  // Axes
  reader.seek(axesArrayOffset)
  const axes: VariationAxis[] = []
  const axisTags = new Set<string>()
  for (let i = 0; i < axisCount; i++) {
    const axisStart = reader.position
    const tag = reader.readTag()
    validateAxisTag(tag, i)
    if (axisTags.has(tag)) {
      throw new Error(`fvar axis tag must be unique, got duplicate '${tag}'`)
    }
    axisTags.add(tag)
    const minValue = reader.readFixed()
    const defaultValue = reader.readFixed()
    const maxValue = reader.readFixed()
    if (minValue > defaultValue || defaultValue > maxValue) {
      throw new Error(`fvar axis '${tag}' values must satisfy min <= default <= max`)
    }
    const flags = reader.readUint16()
    if (minorVersion <= FVAR_MINOR_VERSION && (flags & ~FVAR_AXIS_FLAG_HIDDEN) !== 0) {
      throw new Error(`fvar axis '${tag}' flags contain reserved bits: 0x${flags.toString(16)}`)
    }
    const axisNameId = reader.readUint16()
    validateAxisNameId(axisNameId, tag)
    axes.push({ tag, minValue, defaultValue, maxValue, flags, axisNameId })
    reader.seek(axisStart + axisSize)
  }

  // Named Instances
  const instances: NamedInstance[] = []
  for (let i = 0; i < instanceCount; i++) {
    const instanceStart = reader.position
    const subfamilyNameId = reader.readUint16()
    validateSubfamilyNameId(subfamilyNameId, i)
    const flags = reader.readUint16()
    if (minorVersion <= FVAR_MINOR_VERSION && flags !== 0) {
      throw new Error(`fvar instance ${i} flags must be zero, got ${flags}`)
    }
    const coordinates = new Map<string, number>()
    for (const axis of axes) {
      const coordinate = reader.readFixed()
      if (coordinate < axis.minValue || coordinate > axis.maxValue) {
        throw new Error(`fvar instance ${i} coordinate for '${axis.tag}' must be within the axis range`)
      }
      coordinates.set(axis.tag, coordinate)
    }
    let postScriptNameId: number | undefined
    if (instanceSize > 4 + axisCount * 4) {
      postScriptNameId = reader.readUint16()
      validatePostScriptNameId(postScriptNameId, i)
    }
    instances.push({ subfamilyNameId, flags, coordinates, postScriptNameId })
    reader.seek(instanceStart + instanceSize)
  }

  return {
    axes,
    instances,
    getAxisIndex(tag: string): number {
      return axes.findIndex(a => a.tag === tag)
    },
  }
}

function validateAxisTag(tag: string, axisIndex: number): void {
  const first = tag.charCodeAt(0)
  if (!isAsciiLetter(first)) {
    throw new Error(`fvar axis ${axisIndex} tag must begin with an ASCII letter: ${tag}`)
  }
  let seenSpace = false
  for (let i = 0; i < 4; i++) {
    const code = tag.charCodeAt(i)
    if (code === 0x20) {
      seenSpace = true
      continue
    }
    if (seenSpace) {
      throw new Error(`fvar axis ${axisIndex} tag spaces must be trailing: ${tag}`)
    }
    if (!isAsciiLetter(code) && !isAsciiDigit(code)) {
      throw new Error(`fvar axis ${axisIndex} tag must contain only letters, digits, or trailing spaces: ${tag}`)
    }
  }
}

function validateAxisNameId(nameId: number, tag: string): void {
  if (nameId <= 255 || nameId >= 32768) {
    throw new Error(`fvar axis '${tag}' axisNameID must be greater than 255 and less than 32768, got ${nameId}`)
  }
}

function validateSubfamilyNameId(nameId: number, instanceIndex: number): void {
  if (nameId === 2 || nameId === 17) return
  if (nameId > 255 && nameId < 32768) return
  throw new Error(`fvar instance ${instanceIndex} subfamilyNameID must be 2, 17, or in 256..32767, got ${nameId}`)
}

function validatePostScriptNameId(nameId: number, instanceIndex: number): void {
  if (nameId === 6 || nameId === 0xFFFF) return
  if (nameId > 255 && nameId < 32768) return
  throw new Error(`fvar instance ${instanceIndex} postScriptNameID must be 6, 0xFFFF, or in 256..32767, got ${nameId}`)
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}
