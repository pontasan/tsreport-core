import { BinaryReader } from '../../binary/reader.js'
import { parseAatLookupTable } from './aat-common.js'

const PROP_VERSION_1 = 0x00010000
const PROP_VERSION_2 = 0x00020000
const PROP_VERSION_3 = 0x00030000
const PROP_HEADER_SIZE = 8
const PROP_RESERVED_MASK = 0x0060

/**
 * prop table: Glyph Properties (Apple Advanced Typography)
 *
 * Header: version(Fixed) + format(2) + defaultProperties(2)
 * Format 0: no lookup data (all glyphs use the default properties)
 * Format 1: lookup table with per-glyph 16-bit property words
 */

/** Non-spacing glyph (floater) */
export const PROP_FLOATER = 0x8000
/** Can hang off the left (horizontal) / top (vertical) edge */
export const PROP_HANG_OFF_LEFT_TOP = 0x4000
/** Can hang off the right (horizontal) / bottom (vertical) edge */
export const PROP_HANG_OFF_RIGHT_BOTTOM = 0x2000
/** Use complementary bracketing (mirror) in right-to-left context */
export const PROP_USE_COMPLEMENTARY_BRACKET = 0x1000
/** 4-bit signed offset to the complementary bracket glyph */
export const PROP_COMPLEMENT_OFFSET_MASK = 0x0F00
/** Glyph attaches to the glyph on its right (version 2.0+) */
export const PROP_ATTACHES_ON_RIGHT = 0x0080
/** Directionality class (5 bits, version 3.0 uses all five) */
export const PROP_DIRECTIONALITY_MASK = 0x001F

/**
 * Decodes the 4-bit signed complementary bracket (mirror) glyph offset
 * from a property word. Returns 0 when the glyph has no complement.
 */
export function getComplementOffset(properties: number): number {
  const nibble = (properties & PROP_COMPLEMENT_OFFSET_MASK) >> 8
  return nibble >= 8 ? nibble - 16 : nibble
}

export interface PropTable {
  readonly version: number
  readonly format: number
  readonly defaultProperties: number
  /** 16-bit property word for the glyph (default properties if unlisted) */
  getProperties(glyphId: number): number
}

export function parseProp(reader: BinaryReader, numGlyphs?: number): PropTable {
  const tableStart = reader.position

  validateRange(reader, tableStart, PROP_HEADER_SIZE, 'prop header')

  const rawVersion = reader.readUint32()
  const version = rawVersion / 65536
  if (rawVersion !== PROP_VERSION_1 && rawVersion !== PROP_VERSION_2 && rawVersion !== PROP_VERSION_3) {
    throw new Error(`Unsupported prop table version: 0x${rawVersion.toString(16).padStart(8, '0')}`)
  }

  const format = reader.readUint16()
  const defaultProperties = reader.readUint16()
  validateProperties(defaultProperties, rawVersion, undefined, numGlyphs, 'prop defaultProperties')

  let lookup: Map<number, number> | null = null
  if (format === 0) {
    if (reader.length !== tableStart + PROP_HEADER_SIZE) {
      throw new Error('prop format 0 must not contain lookup data')
    }
  } else if (format === 1) {
    validateRange(reader, tableStart + PROP_HEADER_SIZE, 2, 'prop lookup table')
    const lookupFormat = reader.getUint16At(tableStart + PROP_HEADER_SIZE)
    if (!isSupportedPropLookupFormat(lookupFormat)) {
      throw new Error(`Unsupported prop lookup format: ${lookupFormat}`)
    }
    lookup = parseAatLookupTable(reader, tableStart + 8, numGlyphs)
    validateLookupProperties(lookup, rawVersion, numGlyphs)
  } else {
    throw new Error(`Unsupported prop format: ${format}`)
  }

  return {
    version,
    format,
    defaultProperties,
    getProperties(glyphId: number): number {
      if (lookup === null) return defaultProperties
      return lookup.get(glyphId) ?? defaultProperties
    },
  }
}

function validateLookupProperties(mapping: Map<number, number>, rawVersion: number, numGlyphs: number | undefined): void {
  for (const [glyphId, properties] of mapping) {
    validateProperties(properties, rawVersion, glyphId, numGlyphs, `prop glyph ${glyphId} properties`)
  }
}

function validateProperties(
  properties: number,
  rawVersion: number,
  glyphId: number | undefined,
  numGlyphs: number | undefined,
  label: string,
): void {
  if (properties > 0xFFFF) {
    throw new Error(`${label} must be a 16-bit property value, got ${properties}`)
  }
  if ((properties & PROP_RESERVED_MASK) !== 0) {
    throw new Error(`${label} reserved bits 0x0060 must be zero`)
  }
  if (rawVersion === PROP_VERSION_1 && (properties & PROP_ATTACHES_ON_RIGHT) !== 0) {
    throw new Error(`${label} attaches-on-right bit is invalid in prop version 1.0`)
  }
  const directionality = properties & PROP_DIRECTIONALITY_MASK
  if (rawVersion !== PROP_VERSION_3 && directionality > 11) {
    throw new Error(`${label} directionality class ${directionality} requires prop version 3.0`)
  }
  if (glyphId !== undefined && numGlyphs !== undefined) {
    const complementOffset = getComplementOffset(properties)
    const complementGlyph = glyphId + complementOffset
    if (complementOffset !== 0 && (complementGlyph < 0 || complementGlyph >= numGlyphs)) {
      throw new Error(`${label} complementary glyph ${complementGlyph} exceeds numGlyphs ${numGlyphs}`)
    }
  }
}

function isSupportedPropLookupFormat(format: number): boolean {
  return format === 0 || format === 2 || format === 4 || format === 6 || format === 8
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset > reader.length || offset + length > reader.length) {
    throw new Error(`${label} exceeds prop table length`)
  }
}
