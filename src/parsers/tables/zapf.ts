import { BinaryReader } from '../../binary/reader.js'
import { parseAatLookupTable } from './aat-common.js'

const ZAPF_HEADER_SIZE = 8
const ZAPF_CANONICAL_GLYPH = 0x80
const ZAPF_CONTEXT_MASK = 0x00FF

export interface ZapfIdentifier {
  readonly kind: number
  readonly name: string | null
  readonly value: number | null
}

export interface ZapfSubgroup {
  readonly flags: number | null
  readonly nameIndex: number
  readonly glyphs: readonly number[]
}

export interface ZapfGroup {
  /** Byte offset from the extraInfo origin. */
  readonly offset: number
  readonly subgroups: readonly ZapfSubgroup[]
}

export interface ZapfFeatureInfo {
  readonly context: number
  readonly aatFeatures: readonly { featureType: number, featureSetting: number }[]
  readonly otTags: readonly string[]
}

export interface ZapfGlyphInfo {
  readonly flags: number
  readonly unicodes: readonly number[]
  readonly identifiers: readonly ZapfIdentifier[]
  /** Offset-array slots in order; null is the 0xFFFFFFFF no-group sentinel. */
  readonly groupReferences: readonly (number | null)[]
  readonly groups: readonly ZapfGroup[]
  readonly feature: ZapfFeatureInfo | null
}

export interface ZapfTable {
  readonly version: number
  getGlyphInfo(glyphId: number): ZapfGlyphInfo | null
}

export function parseZapf(reader: BinaryReader, numGlyphs?: number): ZapfTable {
  const tableStart = reader.position
  validateRange(reader, tableStart, ZAPF_HEADER_SIZE, 'Zapf header')
  const version = reader.readUint16()
  if (version !== 1 && version !== 2) throw new Error(`Unsupported Zapf table version: ${version}`)
  const unused = reader.readUint16()
  if (unused !== 0) throw new Error(`Zapf unused header field must be zero, got ${unused}`)
  const extraInfoOffset = reader.readUint32()
  const extraInfoStart = tableStart + extraInfoOffset
  validateRange(reader, extraInfoStart, 0, 'Zapf extraInfo')

  const offsets = new Map<number, number>()
  if (version === 1) {
    if (numGlyphs === undefined) throw new Error('Zapf version 1 requires numGlyphs')
    validateRange(reader, tableStart + ZAPF_HEADER_SIZE, numGlyphs * 4, 'Zapf version 1 glyph offset array')
    if (extraInfoStart < tableStart + ZAPF_HEADER_SIZE + numGlyphs * 4) {
      throw new Error('Zapf extraInfo overlaps version 1 glyph offset array')
    }
    for (let glyphId = 0; glyphId < numGlyphs; glyphId++) {
      offsets.set(glyphId, reader.getUint32At(tableStart + ZAPF_HEADER_SIZE + glyphId * 4))
    }
  } else {
    validateRange(reader, tableStart + ZAPF_HEADER_SIZE, 4, 'Zapf version 2 lookup header')
    validateZapfLookupValueSize(reader, tableStart + ZAPF_HEADER_SIZE)
    const lookup = parseAatLookupTable(reader, tableStart + ZAPF_HEADER_SIZE, numGlyphs, 4)
    for (const [glyphId, offset] of lookup) {
      if (numGlyphs !== undefined && glyphId >= numGlyphs) {
        throw new Error(`Zapf lookup glyph ${glyphId} exceeds numGlyphs ${numGlyphs}`)
      }
      offsets.set(glyphId, offset)
    }
  }

  const infoByGlyph = new Map<number, ZapfGlyphInfo>()
  const infoCache = new Map<number, ZapfGlyphInfo>()
  for (const [glyphId, offset] of offsets) {
    if (offset === 0) continue
    const infoStart = tableStart + offset
    validateRange(reader, infoStart, 10, `Zapf glyph ${glyphId} GlyphInfo`)
    let info = infoCache.get(offset)
    if (info === undefined) {
      info = parseGlyphInfo(reader, tableStart, infoStart, extraInfoStart, numGlyphs)
      infoCache.set(offset, info)
    }
    infoByGlyph.set(glyphId, info)
  }

  return {
    version,
    getGlyphInfo(glyphId: number): ZapfGlyphInfo | null {
      return infoByGlyph.get(glyphId) ?? null
    },
  }
}

function validateZapfLookupValueSize(reader: BinaryReader, offset: number): void {
  const format = reader.getUint16At(offset)
  if (format === 2 || format === 6) {
    const unitSize = reader.getUint16At(offset + 2)
    const expected = format === 2 ? 8 : 6
    if (unitSize !== expected) throw new Error(`Zapf lookup format ${format} unitSize must be ${expected}, got ${unitSize}`)
  }
}

function parseGlyphInfo(
  reader: BinaryReader,
  tableStart: number,
  infoStart: number,
  extraInfoStart: number,
  numGlyphs: number | undefined,
): ZapfGlyphInfo {
  validateRange(reader, infoStart, 10, 'Zapf GlyphInfo header')
  reader.seek(infoStart)
  const groupOffset = reader.readUint32()
  const featOffset = reader.readUint32()
  const flags = reader.readUint8()
  if ((flags & ~ZAPF_CANONICAL_GLYPH) !== 0) {
    throw new Error(`Zapf GlyphInfo flags contain reserved bits: 0x${flags.toString(16).padStart(2, '0')}`)
  }
  const num16BitUnicodes = reader.readUint8()
  validateRange(reader, reader.position, num16BitUnicodes * 2 + 2, 'Zapf GlyphInfo Unicode string')
  const unicodes = new Array<number>(num16BitUnicodes)
  for (let i = 0; i < num16BitUnicodes; i++) unicodes[i] = reader.readUint16()
  validateUtf16(unicodes)

  const numIdentifiers = reader.readUint16()
  const identifiers = new Array<ZapfIdentifier>(numIdentifiers)
  for (let i = 0; i < numIdentifiers; i++) {
    validateRange(reader, reader.position, 1, `Zapf GlyphIdentifier ${i}`)
    const kind = reader.readUint8()
    if (kind >= 128) throw new Error(`Zapf GlyphIdentifier ${i} kind ${kind} is reserved`)
    if (kind < 64) {
      validateRange(reader, reader.position, 1, `Zapf GlyphIdentifier ${i} Pascal length`)
      const length = reader.readUint8()
      validateRange(reader, reader.position, length, `Zapf GlyphIdentifier ${i} Pascal string`)
      const bytes = reader.readBytes(length)
      let name: string
      try {
        name = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new Error(`Zapf GlyphIdentifier ${i} contains malformed UTF-8`)
      }
      identifiers[i] = { kind, name, value: null }
    } else {
      validateRange(reader, reader.position, 2, `Zapf GlyphIdentifier ${i} binary value`)
      identifiers[i] = { kind, name: null, value: reader.readUint16() }
    }
  }

  const groupData = groupOffset === 0xFFFFFFFF
    ? { groups: [] as ZapfGroup[], references: [] as (number | null)[] }
    : parseGroups(reader, extraInfoStart, groupOffset, numGlyphs)
  const feature = featOffset === 0xFFFFFFFF
    ? null
    : parseFeatureInfo(reader, extraInfoStart + featOffset)
  void tableStart
  return { flags, unicodes, identifiers, groupReferences: groupData.references, groups: groupData.groups, feature }
}

function parseGroups(
  reader: BinaryReader,
  extraInfoStart: number,
  groupOffset: number,
  numGlyphs: number | undefined,
): { groups: ZapfGroup[], references: (number | null)[] } {
  const start = extraInfoStart + groupOffset
  validateRange(reader, start, 2, 'Zapf glyph group')
  const header = reader.getUint16At(start)
  const count = header & 0x3FFF
  if ((header & 0x4000) !== 0) {
    if ((header & 0x8000) !== 0) throw new Error('Zapf GlyphGroupOffsetArray bit 15 must be zero')
    validateRange(reader, start, 4 + count * 4, 'Zapf GlyphGroupOffsetArray')
    if (reader.getUint16At(start + 2) !== 0) throw new Error('Zapf GlyphGroupOffsetArray padding must be zero')
    const groups: ZapfGroup[] = []
    const references = new Array<number | null>(count)
    for (let i = 0; i < count; i++) {
      const offset = reader.getUint32At(start + 4 + i * 4)
      references[i] = offset === 0xFFFFFFFF ? null : offset
      if (offset === 0xFFFFFFFF) continue
      const target = extraInfoStart + offset
      validateRange(reader, target, 2, `Zapf GlyphGroupOffsetArray group ${i}`)
      // Shipping Apple tables use an offset-array node as a shared collection
      // identity (including self-references). Preserve that reference in
      // groupReferences; only concrete GlyphGroup targets have subgroups.
      if ((reader.getUint16At(target) & 0x4000) === 0) {
        groups.push({ offset, subgroups: parseSubgroups(reader, target, numGlyphs) })
      }
    }
    return { groups, references }
  }
  return {
    groups: [{ offset: groupOffset, subgroups: parseSubgroups(reader, start, numGlyphs) }],
    references: [groupOffset],
  }
}

function parseSubgroups(reader: BinaryReader, groupStart: number, numGlyphs: number | undefined): ZapfSubgroup[] {
  validateRange(reader, groupStart, 2, 'Zapf GlyphGroup')
  reader.seek(groupStart)
  const numGroups = reader.readUint16()
  if ((numGroups & 0x4000) !== 0) throw new Error('Zapf GlyphGroup must not set the offset-array bit')
  const hasFlags = (numGroups & 0x8000) !== 0
  const count = numGroups & 0x3FFF
  const subgroups = new Array<ZapfSubgroup>(count)
  for (let i = 0; i < count; i++) {
    validateRange(reader, reader.position, hasFlags ? 6 : 4, `Zapf GlyphSubgroup ${i} header`)
    const flags = hasFlags ? reader.readUint16() : null
    if (flags !== null && (flags & 0x3FFF) !== 0) {
      throw new Error(`Zapf GlyphSubgroup ${i} flags contain reserved bits`)
    }
    const nameIndex = reader.readUint16()
    const glyphCount = reader.readUint16()
    validateRange(reader, reader.position, glyphCount * 2, `Zapf GlyphSubgroup ${i} glyphs`)
    const glyphs = new Array<number>(glyphCount)
    for (let j = 0; j < glyphCount; j++) {
      const glyphId = reader.readUint16()
      if (numGlyphs !== undefined && glyphId >= numGlyphs) {
        throw new Error(`Zapf GlyphSubgroup ${i} glyph ${glyphId} exceeds numGlyphs ${numGlyphs}`)
      }
      glyphs[j] = glyphId
    }
    if (flags !== null && (flags & 0x8000) !== 0) {
      while ((reader.position & 3) !== 0) {
        if (reader.readUint8() !== 0) throw new Error(`Zapf GlyphSubgroup ${i} alignment padding must be zero`)
      }
    }
    subgroups[i] = { flags, nameIndex, glyphs }
  }
  return subgroups
}

function parseFeatureInfo(reader: BinaryReader, start: number): ZapfFeatureInfo {
  validateRange(reader, start, 4, 'Zapf FeatureInfo header')
  reader.seek(start)
  const context = reader.readUint16()
  if ((context & ~ZAPF_CONTEXT_MASK) !== 0) throw new Error(`Zapf FeatureInfo context has reserved bits: 0x${context.toString(16)}`)
  const nAatFeatures = reader.readUint16()
  validateRange(reader, reader.position, nAatFeatures * 4 + 2, 'Zapf FeatureInfo AAT features')
  const aatFeatures = new Array<{ featureType: number, featureSetting: number }>(nAatFeatures)
  for (let i = 0; i < nAatFeatures; i++) {
    aatFeatures[i] = { featureType: reader.readUint16(), featureSetting: reader.readUint16() }
  }
  // Apple's binary examples and shipping tables encode this count as UInt16;
  // the manual's prose table labels it UInt32, but its byte offsets and examples
  // advance by two bytes. Follow the normative binary layout demonstrated there.
  const nOtTags = reader.readUint16()
  validateRange(reader, reader.position, nOtTags * 4, 'Zapf FeatureInfo OpenType tags')
  const otTags = new Array<string>(nOtTags)
  for (let i = 0; i < nOtTags; i++) {
    const tag = reader.readTag()
    for (let j = 0; j < 4; j++) {
      const code = tag.charCodeAt(j)
      if (code < 0x20 || code > 0x7E) throw new Error(`Zapf FeatureInfo OpenType tag ${i} must contain printable ASCII`)
    }
    otTags[i] = tag
  }
  return { context, aatFeatures, otTags }
}

function validateUtf16(values: readonly number[]): void {
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!
    if (value >= 0xD800 && value <= 0xDBFF) {
      const low = values[++i]
      if (low === undefined || low < 0xDC00 || low > 0xDFFF) throw new Error('Zapf GlyphInfo Unicode string has an unpaired high surrogate')
    } else if (value >= 0xDC00 && value <= 0xDFFF) {
      throw new Error('Zapf GlyphInfo Unicode string has an unpaired low surrogate')
    }
  }
}

function validateRange(reader: BinaryReader, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset > reader.length || length > reader.length - offset) {
    throw new Error(`${label} exceeds Zapf table length`)
  }
}
