import { BinaryReader } from '../../binary/reader.js'
import { BinaryWriter } from '../../binary/writer.js'

function requireGraphiteRange(reader: BinaryReader, offset: number, length: number, context: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < 0 || length < 0 || offset + length > reader.length) {
    throw new Error(`${context} exceeds the Graphite table bounds`)
  }
}

/**
 * SIL Graphite font tables: Silf, Gloc, Glat, Sill, Feat
 * Based on the Graphite Table Format specification (GTF) version 4.0/5.0
 * https://github.com/silnrsi/graphite/blob/master/doc/GTF.adoc
 *
 * Versions are stored as raw 16.16 fixed-point values (e.g. 0x00050000 = 5.0)
 * so that version comparisons stay exact.
 */

// ---------------------------------------------------------------------------
// Compression (GTF 5.0): Silf and Glat tables may be LZ4 block compressed.
// A compressed table is: FIXED version + ULONG (scheme:5 | fullSize:27)
// + compressed data. The uncompressed form is the complete table including
// the version number, with the scheme field set to 0.
// ---------------------------------------------------------------------------

/**
 * Decompresses a raw LZ4 block (no framing, no checksums) into dst
 * starting at dstOffset. Returns the number of bytes written.
 * Match offsets are little-endian per the LZ4 block specification.
 */
export function decompressLz4Block(src: Uint8Array, dst: Uint8Array, dstOffset: number): number {
  let s = 0
  let d = dstOffset
  const srcLen = src.length
  const dstLen = dst.length

  while (s < srcLen) {
    const token = src[s]!
    s += 1

    // Literal run
    let litLen = token >>> 4
    if (litLen === 15) {
      let b: number
      do {
        b = src[s]!
        s += 1
        litLen += b
      } while (b === 255)
    }
    if (s + litLen > srcLen || d + litLen > dstLen) {
      throw new Error('LZ4 block: literal run exceeds buffer bounds')
    }
    for (let i = 0; i < litLen; i++) {
      dst[d] = src[s]!
      d += 1
      s += 1
    }
    if (s >= srcLen) {
      break // the last sequence contains only literals
    }

    // Match copy
    const offset = src[s]! | (src[s + 1]! << 8)
    s += 2
    if (offset === 0 || offset > d - dstOffset) {
      throw new Error('LZ4 block: invalid match offset')
    }
    let matchLen = (token & 15) + 4
    if ((token & 15) === 15) {
      let b: number
      do {
        b = src[s]!
        s += 1
        matchLen += b
      } while (b === 255)
    }
    if (d + matchLen > dstLen) {
      throw new Error('LZ4 block: match run exceeds buffer bounds')
    }
    let m = d - offset
    for (let i = 0; i < matchLen; i++) {
      dst[d] = dst[m]!
      d += 1
      m += 1
    }
  }
  return d - dstOffset
}

/** Encodes a byte array as one valid raw LZ4 block. */
export function compressLz4Block(data: Uint8Array): Uint8Array {
  const writer = new BinaryWriter(data.length + Math.ceil(data.length / 255) + 2)
  const literalNibble = Math.min(data.length, 15)
  writer.writeUint8(literalNibble << 4)
  if (data.length >= 15) {
    let remaining = data.length - 15
    while (remaining >= 255) {
      writer.writeUint8(255)
      remaining -= 255
    }
    writer.writeUint8(remaining)
  }
  writer.writeBytes(data)
  return writer.toUint8Array()
}

/** Wraps an uncompressed Silf 5 or Glat 3 table in Graphite LZ4 scheme 1. */
export function compressGraphiteTable(data: Uint8Array, table: 'Glat' | 'Silf'): Uint8Array {
  if (data.length < 8) throw new Error('Graphite table is too short to compress')
  if (data.length > 0x07ffffff) throw new Error('Graphite table exceeds the compressed size field')
  const version = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false)
  const major = version >>> 16
  if (table === 'Glat' ? major !== 3 : major !== 5) {
    throw new Error(`Graphite ${table} table version ${major} does not define compression`)
  }
  const compressed = compressLz4Block(data)
  const writer = new BinaryWriter(8 + compressed.length)
  writer.writeUint32(version)
  writer.writeUint32((1 << 27) | data.length)
  writer.writeBytes(compressed)
  return writer.toUint8Array()
}

/**
 * Rebuilds the uncompressed form of a compressed Graphite table.
 * The reader must span the whole table; compressionWord is the second ULONG
 * (scheme in the top 5 bits, uncompressed full size in the low 27 bits).
 * The LZ4 block expands to the complete table, including its version word.
 */
function decompressGraphiteTable(reader: BinaryReader, compressionWord: number): BinaryReader {
  const scheme = compressionWord >>> 27
  if (scheme !== 1) {
    throw new Error(`Unsupported Graphite compression scheme: ${scheme}`)
  }
  const fullSize = compressionWord & 0x07ffffff
  const compressedSize = reader.length - 8
  if (fullSize < 8 || fullSize > 8 + compressedSize * 255) {
    throw new Error('Graphite compressed table declares an impossible uncompressed size')
  }
  const out = new Uint8Array(fullSize)
  reader.seek(8)
  const compressed = reader.readBytes(reader.remaining)
  const written = decompressLz4Block(compressed, out, 0)
  if (written !== fullSize) throw new Error('Graphite LZ4 block has an invalid uncompressed size')
  return new BinaryReader(out.buffer)
}

// ---------------------------------------------------------------------------
// Gloc table: glyph attribute locations (index into Glat)
// ---------------------------------------------------------------------------

export class GlocTable {
  /** Raw 16.16 table version (0x00010000 or 0x00010001) */
  readonly version: number
  /** bit 0 = long (32-bit) locations, bit 1 = attribIds array present */
  readonly flags: number
  /** Number of attributes */
  readonly numAttribs: number
  /** Byte offsets into the Glat table, one per glyph plus a final terminator */
  readonly locations: Uint32Array
  /** Debug name-table IDs for each attribute (null when stripped) */
  readonly attribIds: Uint16Array | null

  constructor(version: number, flags: number, numAttribs: number, locations: Uint32Array, attribIds: Uint16Array | null) {
    this.version = version
    this.flags = flags
    this.numAttribs = numAttribs
    this.locations = locations
    this.attribIds = attribIds
  }

  get isLongFormat(): boolean {
    return (this.flags & 1) !== 0
  }

  get hasAttribIds(): boolean {
    return (this.flags & 2) !== 0
  }

  /** Number of glyphs covered by the locations array */
  get numGlyphs(): number {
    return this.locations.length - 1
  }
}

export function parseGloc(reader: BinaryReader): GlocTable {
  requireGraphiteRange(reader, 0, 8, 'Gloc header')
  const version = reader.readUint32()
  if ((version >>> 16) !== 1) {
    throw new Error(`Unsupported Gloc table version: 0x${version.toString(16).padStart(8, '0')}`)
  }
  const flags = reader.readUint16()
  const numAttribs = reader.readUint16()

  const isLong = (flags & 1) !== 0
  const hasIds = (flags & 2) !== 0

  // The glyph count is not stored in the table; it is derived from the
  // table length minus the header and the trailing attribIds array.
  const attribIdsSize = hasIds ? numAttribs * 2 : 0
  const locationBytes = reader.length - 8 - attribIdsSize
  const entrySize = isLong ? 4 : 2
  if (locationBytes < entrySize || locationBytes % entrySize !== 0) {
    throw new Error('Gloc location array has an invalid length')
  }
  const locationCount = locationBytes / entrySize
  const locations = new Uint32Array(locationCount)
  if (isLong) {
    for (let i = 0; i < locationCount; i++) {
      locations[i] = reader.readUint32()
    }
  } else {
    for (let i = 0; i < locationCount; i++) {
      locations[i] = reader.readUint16()
    }
  }

  for (let i = 1; i < locations.length; i++) {
    if (locations[i]! < locations[i - 1]!) throw new Error('Gloc locations are not monotonic')
  }

  const attribIds = hasIds ? reader.readUint16Array(numAttribs) : null
  return new GlocTable(version, flags, numAttribs, locations, attribIds)
}

// ---------------------------------------------------------------------------
// Glat table: glyph attributes (run-length encoded sparse arrays)
// ---------------------------------------------------------------------------

/** Octabox approximation for one cell of the 4x4 subbox grid */
export interface GlatSubbox {
  left: number
  right: number
  bottom: number
  top: number
  diagNegMin: number
  diagNegMax: number
  diagPosMin: number
  diagPosMax: number
}

/** Octabox metrics for a whole glyph (Glat version 3 with octaboxes flag) */
export interface GlatOctabox {
  /** Bit set of existing subboxes; bit index = (y * 4) + x */
  subboxBitmap: number
  diagNegMin: number
  diagNegMax: number
  diagPosMin: number
  diagPosMax: number
  /** One entry per set bit in subboxBitmap, in ascending bit order */
  subboxes: GlatSubbox[]
}

/** One run of contiguous glyph attributes */
export interface GlatAttrRun {
  /** Attribute number of the first attribute in the run */
  firstAttr: number
  /** Attribute values for firstAttr, firstAttr+1, ... */
  values: Int16Array
}

/** Parsed attribute data for one glyph */
export interface GlatGlyphAttrs {
  octabox: GlatOctabox | null
  runs: GlatAttrRun[]
}

export class GlatTable {
  /** Raw 16.16 table version (0x00010000, 0x00020000 or 0x00030000) */
  readonly version: number
  /** Whether per-glyph octabox metrics precede the attribute runs (version 3) */
  readonly hasOctaboxes: boolean
  private readonly reader: BinaryReader
  private readonly gloc: GlocTable
  private readonly cache: Map<number, GlatGlyphAttrs>

  constructor(version: number, hasOctaboxes: boolean, reader: BinaryReader, gloc: GlocTable) {
    this.version = version
    this.hasOctaboxes = hasOctaboxes
    this.reader = reader
    this.gloc = gloc
    this.cache = new Map()
  }

  /** Parses the attribute block of one glyph (Gloc gives the byte range) */
  getGlyphAttrs(glyphId: number): GlatGlyphAttrs {
    const cached = this.cache.get(glyphId)
    if (cached) {
      return cached
    }
    if (glyphId < 0 || glyphId >= this.gloc.numGlyphs) {
      throw new Error(`Glyph ID ${glyphId} out of Gloc range (${this.gloc.numGlyphs} glyphs)`)
    }

    const r = this.reader
    const start = this.gloc.locations[glyphId]!
    const end = this.gloc.locations[glyphId + 1]!
    requireGraphiteRange(r, start, end - start, `Glat glyph ${glyphId}`)
    r.seek(start)

    let octabox: GlatOctabox | null = null
    if (this.hasOctaboxes && end > start) {
      if (end - start < 6) throw new Error(`Glat glyph ${glyphId} has a truncated octabox`)
      const subboxBitmap = r.readUint16()
      const diagNegMin = r.readUint8()
      const diagNegMax = r.readUint8()
      const diagPosMin = r.readUint8()
      const diagPosMax = r.readUint8()
      const subboxes: GlatSubbox[] = []
      for (let bit = 0; bit < 16; bit++) {
        if ((subboxBitmap & (1 << bit)) !== 0) {
          if (r.position + 8 > end) throw new Error(`Glat glyph ${glyphId} has a truncated octabox subbox`)
          subboxes.push({
            left: r.readUint8(),
            right: r.readUint8(),
            bottom: r.readUint8(),
            top: r.readUint8(),
            diagNegMin: r.readUint8(),
            diagNegMax: r.readUint8(),
            diagPosMin: r.readUint8(),
            diagPosMax: r.readUint8(),
          })
        }
      }
      octabox = { subboxBitmap, diagNegMin, diagNegMax, diagPosMin, diagPosMax, subboxes }
    }

    // Version 1 uses BYTE attNum/num; versions 2 and 3 use USHORT
    const wide = this.version >= 0x00020000
    const runs: GlatAttrRun[] = []
    while (r.position < end) {
      const headerSize = wide ? 4 : 2
      if (r.position + headerSize > end) throw new Error(`Glat glyph ${glyphId} has a truncated attribute run`)
      const firstAttr = wide ? r.readUint16() : r.readUint8()
      const num = wide ? r.readUint16() : r.readUint8()
      if (num === 0 || r.position + num * 2 > end) {
        throw new Error(`Glat glyph ${glyphId} has an invalid attribute run`)
      }
      runs.push({ firstAttr, values: r.readInt16Array(num) })
    }

    const attrs: GlatGlyphAttrs = { octabox, runs }
    this.cache.set(glyphId, attrs)
    return attrs
  }

  /**
   * Returns the value of one glyph attribute.
   * Glyph attributes form a sparse array; attributes not stored in any run
   * have the value 0 per the Graphite engine semantics.
   */
  getAttr(glyphId: number, attrNum: number): number {
    const runs = this.getGlyphAttrs(glyphId).runs
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!
      const idx = attrNum - run.firstAttr
      if (idx >= 0 && idx < run.values.length) {
        return run.values[idx]!
      }
    }
    return 0
  }
}

export function parseGlat(reader: BinaryReader, gloc: GlocTable): GlatTable {
  requireGraphiteRange(reader, 0, 4, 'Glat header')
  const version = reader.readUint32()
  const major = version >>> 16
  if (major < 1 || major > 3) {
    throw new Error(`Unsupported Glat table version: 0x${version.toString(16).padStart(8, '0')}`)
  }

  let r = reader
  let hasOctaboxes = false
  if (major >= 3) {
    requireGraphiteRange(reader, 0, 8, 'Glat version 3 header')
    const word = reader.readUint32()
    const scheme = word >>> 27
    if (scheme !== 0) {
      r = decompressGraphiteTable(reader, word)
      r.seek(4)
      const uncompressedWord = r.readUint32()
      hasOctaboxes = (uncompressedWord & 1) !== 0
    } else {
      hasOctaboxes = (word & 1) !== 0
    }
    // Version 3 glyph records always carry the six-byte octabox header. Some
    // Graphite compilers left the flag clear while still writing that header.
    hasOctaboxes = true
  }
  const headerSize = major >= 3 ? 8 : 4
  if (gloc.locations[0] !== headerSize) throw new Error('Gloc first location does not follow the Glat header')
  if (gloc.locations[gloc.locations.length - 1]! > r.length) throw new Error('Gloc locations exceed the Glat table')
  return new GlatTable(version, hasOctaboxes, r, gloc)
}

// ---------------------------------------------------------------------------
// Sill table: language tag -> default feature settings
// ---------------------------------------------------------------------------

export interface SillFeatureSetting {
  /** Feature ID number (matches an ID in the Graphite Feat table) */
  featureId: number
  /** Default feature value for this language */
  value: number
}

export interface SillLanguage {
  /** ISO-639 language code with trailing NUL padding stripped */
  langCode: string
  settings: SillFeatureSetting[]
}

export class SillTable {
  /** Raw 16.16 table version (0x00010000) */
  readonly version: number
  readonly languages: SillLanguage[]
  private readonly languageMap: Map<string, number>

  constructor(version: number, languages: SillLanguage[]) {
    this.version = version
    this.languages = languages
    this.languageMap = new Map()
    for (let i = 0; i < languages.length; i++) {
      this.languageMap.set(languages[i]!.langCode, i)
    }
  }

  /** Returns the default feature settings for a language code, or null */
  getFeatures(langCode: string): SillFeatureSetting[] | null {
    const idx = this.languageMap.get(langCode)
    return idx !== undefined ? this.languages[idx]!.settings : null
  }
}

export function parseSill(reader: BinaryReader): SillTable {
  requireGraphiteRange(reader, 0, 12, 'Sill header')
  const version = reader.readUint32()
  if ((version >>> 16) !== 1) {
    throw new Error(`Unsupported Sill table version: 0x${version.toString(16).padStart(8, '0')}`)
  }
  const numLangs = reader.readUint16()
  reader.skip(6) // searchRange, entrySelector, rangeShift (deprecated)
  requireGraphiteRange(reader, 12, (numLangs + 1) * 8, 'Sill language directory')

  // numLangs entries followed by one terminator entry (ignored)
  const headers: { langCode: string, numSettings: number, offset: number }[] = []
  for (let i = 0; i < numLangs; i++) {
    const b0 = reader.readUint8()
    const b1 = reader.readUint8()
    const b2 = reader.readUint8()
    const b3 = reader.readUint8()
    let langCode = ''
    if (b0 !== 0) langCode += String.fromCharCode(b0)
    if (b1 !== 0) langCode += String.fromCharCode(b1)
    if (b2 !== 0) langCode += String.fromCharCode(b2)
    if (b3 !== 0) langCode += String.fromCharCode(b3)
    const numSettings = reader.readUint16()
    const offset = reader.readUint16() // relative to the start of the Sill table
    headers.push({ langCode, numSettings, offset })
  }

  const languages: SillLanguage[] = []
  for (let i = 0; i < numLangs; i++) {
    const h = headers[i]!
    requireGraphiteRange(reader, h.offset, h.numSettings * 8, `Sill language ${h.langCode}`)
    reader.seek(h.offset)
    const settings: SillFeatureSetting[] = []
    for (let j = 0; j < h.numSettings; j++) {
      const featureId = reader.readUint32()
      const value = reader.readInt16()
      reader.skip(2) // reserved pad bytes
      settings.push({ featureId, value })
    }
    languages.push({ langCode: h.langCode, settings })
  }

  return new SillTable(version, languages)
}

// ---------------------------------------------------------------------------
// Feat table (Graphite): feature definitions with UI labels
// Note: the SFNT tag is 'Feat' (capital F), distinct from the AAT 'feat'.
// ---------------------------------------------------------------------------

export interface GraphiteFeatureSetting {
  /** Feature setting value */
  value: number
  /** Name table ID for the setting's UI label */
  label: number
}

export interface GraphiteFeature {
  /** Feature ID number (USHORT in version 1.0, ULONG in 2.0+) */
  id: number
  /** Bit 0 = this feature is an alias of the previous one (version 2.1) */
  flags: number
  /** Name table ID for the feature's UI label */
  label: number
  settings: GraphiteFeatureSetting[]
}

export class GraphiteFeatTable {
  /** Raw 16.16 table version (0x00010000, 0x00020000 or 0x00020001) */
  readonly version: number
  readonly features: GraphiteFeature[]
  private readonly featureMap: Map<number, number>

  constructor(version: number, features: GraphiteFeature[]) {
    this.version = version
    this.features = features
    this.featureMap = new Map()
    for (let i = 0; i < features.length; i++) {
      this.featureMap.set(features[i]!.id, i)
    }
  }

  getFeature(id: number): GraphiteFeature | null {
    const idx = this.featureMap.get(id)
    return idx !== undefined ? this.features[idx]! : null
  }
}

export function parseGraphiteFeat(reader: BinaryReader): GraphiteFeatTable {
  requireGraphiteRange(reader, 0, 12, 'Graphite Feat header')
  const version = reader.readUint32()
  const major = version >>> 16
  if (major < 1 || major > 2) {
    throw new Error(`Unsupported Graphite Feat table version: 0x${version.toString(16).padStart(8, '0')}`)
  }
  const numFeat = reader.readUint16()
  reader.skip(2) // reserved
  reader.skip(4) // reserved

  const featureHeaderSize = major >= 2 ? 16 : 12
  requireGraphiteRange(reader, 12, numFeat * featureHeaderSize, 'Graphite Feat directory')
  const headers: { id: number, numSettings: number, offset: number, flags: number, label: number }[] = []
  for (let i = 0; i < numFeat; i++) {
    const id = major >= 2 ? reader.readUint32() : reader.readUint16()
    const numSettings = reader.readUint16()
    if (major >= 2) {
      reader.skip(2) // reserved
    }
    const offset = reader.readUint32() // relative to the start of the Feat table
    const flags = reader.readUint16()
    const label = reader.readUint16()
    headers.push({ id, numSettings, offset, flags, label })
  }

  const features: GraphiteFeature[] = []
  for (let i = 0; i < numFeat; i++) {
    const h = headers[i]!
    requireGraphiteRange(reader, h.offset, h.numSettings * 4, `Graphite Feat feature ${h.id}`)
    reader.seek(h.offset)
    const settings: GraphiteFeatureSetting[] = []
    for (let j = 0; j < h.numSettings; j++) {
      const value = reader.readInt16()
      const label = reader.readUint16()
      settings.push({ value, label })
    }
    features.push({ id: h.id, flags: h.flags, label: h.label, settings })
  }

  return new GraphiteFeatTable(version, features)
}

// ---------------------------------------------------------------------------
// Silf table: rendering rules and actions
// ---------------------------------------------------------------------------

/** Glyph attribute numbers for one justification level */
export interface SilfJustificationLevel {
  attrStretch: number
  attrShrink: number
  attrStep: number
  attrWeight: number
  /** Which level starts the next stage */
  runto: number
}

/** Unicode codepoint -> pseudo-glyph mapping */
export interface SilfPseudoMap {
  unicode: number
  pseudoGlyph: number
}

/** Fast binary-search lookup class (glyph ID -> index) */
export interface SilfLookupClass {
  numIds: number
  searchRange: number
  entrySelector: number
  rangeShift: number
  /** Glyph IDs in ascending order */
  glyphIds: Uint16Array
  /** Index in the original ordered list for each glyph ID */
  indices: Uint16Array
}

/** Replacement classes used by substitution actions */
export interface SilfClassMap {
  numClass: number
  numLinear: number
  /** numClass + 1 byte offsets from the start of the class map */
  offsets: Uint32Array
  /** Glyph arrays for the first numLinear classes */
  linearClasses: Uint16Array[]
  /** Lookup structures for classes numLinear .. numClass-1 */
  lookupClasses: SilfLookupClass[]
}

/** Contiguous glyph ID range mapping to an FSM column */
export interface SilfPassRange {
  firstId: number
  lastId: number
  colId: number
}

/** Debug name-table indices (present only when oDebug is non-zero) */
export interface SilfPassDebug {
  /** Name index for each action (length numRules) */
  dActions: Uint16Array
  /** Name index for each intermediate FSM state (length numRows - numRules) */
  dStates: Uint16Array
  /** Name index for each state (length numRows) */
  dCols: Uint16Array
}

/**
 * One rendering pass: an FSM for rule matching plus constraint/action
 * bytecode blocks. The bytecode is kept as raw byte sequences with the
 * offset metadata needed to slice per-rule blocks (the stack-machine VM
 * itself is not executed here).
 */
export interface SilfPass {
  /** bits 0-2 collision runs, 3-4 kerning collisions, 5 reverse direction */
  flags: number
  maxRuleLoop: number
  maxRuleContext: number
  maxBackup: number
  numRules: number
  /** Offset of the FSM (numRows) relative to the start of this pass */
  fsmOffset: number
  /** Offset to pass constraint code relative to the subtable start (0 = none) */
  pcCode: number
  /** Offset to rule constraint code relative to the subtable start */
  rcCode: number
  /** Offset to action code relative to the subtable start */
  aCode: number
  /** Offset to debug arrays relative to the subtable start (0 = stripped) */
  oDebug: number
  /** Number of FSM states */
  numRows: number
  /** Number of transitional states (rows of the transition matrix) */
  numTransitional: number
  /** Number of success states */
  numSuccess: number
  /** Number of FSM columns */
  numColumns: number
  searchRange: number
  entrySelector: number
  rangeShift: number
  /** Glyph ID ranges mapping to FSM columns */
  ranges: SilfPassRange[]
  /** numSuccess + 1 offsets into ruleMap; entry i corresponds to state numRows - numSuccess + i */
  oRuleMap: Uint16Array
  /** Rule numbers for each success state */
  ruleMap: Uint16Array
  minRulePreContext: number
  maxRulePreContext: number
  /** Start states indexed by available pre-context (maxRulePreContext - minRulePreContext + 1 entries) */
  startStates: Uint16Array
  /** Precedence sort key for each rule (length numRules) */
  ruleSortKeys: Uint16Array
  /** Number of pre-context items for each rule (length numRules) */
  rulePreContext: Uint8Array
  collisionThreshold: number
  /** Length of the pass constraint code block in bytes */
  passConstraintLength: number
  /** numRules + 1 offsets into ruleConstraints for per-rule constraint code */
  oConstraints: Uint16Array
  /** numRules + 1 offsets into actions for per-rule action code */
  oActions: Uint16Array
  /** FSM transition matrix, numTransitional rows * numColumns, flattened row-major */
  stateTransitions: Uint16Array
  /** Pass-level constraint bytecode */
  passConstraints: Uint8Array
  /** Rule constraint bytecode (sliced per rule via oConstraints) */
  ruleConstraints: Uint8Array
  /** Action bytecode (sliced per rule via oActions) */
  actions: Uint8Array
  /** Debug arrays, null when stripped (oDebug = 0) */
  debug: SilfPassDebug | null
}

/** One independent rendering description */
export interface SilfSubtable {
  /** Stack-machine language version (raw 16.16, version 3.0+; 0 otherwise) */
  ruleVersion: number
  /** Offset of oPasses[0] relative to the subtable start (version 3.0+; 0 otherwise) */
  passOffset: number
  /** Offset of pseudo maps relative to the subtable start (version 3.0+; 0 otherwise) */
  pseudosOffset: number
  /** Maximum valid glyph ID including line-break and pseudo glyphs */
  maxGlyphId: number
  extraAscent: number
  extraDescent: number
  numPasses: number
  /** Index of the first substitution pass */
  iSubst: number
  /** Index of the first positioning pass */
  iPos: number
  /** Index of the first justification pass */
  iJust: number
  /** Index of the first pass after the bidi pass; 0xFF = no bidi pass */
  iBidi: number
  /** bit 0 line-end contextuals, bit 1 contextuals, bits 2-4 space contextuals, bit 5 collision pass */
  flags: number
  maxPreContext: number
  maxPostContext: number
  /** Glyph attribute number holding the real glyph ID of a pseudo-glyph */
  attrPseudo: number
  attrBreakWeight: number
  attrDirectionality: number
  attrMirroring: number
  attrSkipPasses: number
  jLevels: SilfJustificationLevel[]
  /** Number of initial glyph attributes representing ligature components */
  numLigComp: number
  numUserDefn: number
  maxCompPerLig: number
  direction: number
  /** First attribute holding collision flags and constraint box */
  attCollisions: number
  critFeatures: Uint16Array
  /** Script tags as 4-character strings */
  scriptTags: string[]
  /** Glyph ID of the line-break pseudo-glyph */
  lbGID: number
  /** numPasses + 1 offsets to passes relative to the subtable start */
  oPasses: Uint32Array
  searchPseudo: number
  pseudoSelector: number
  pseudoShift: number
  pseudoMaps: SilfPseudoMap[]
  classMap: SilfClassMap
  passes: SilfPass[]
}

export interface SilfTable {
  /** Raw 16.16 table version (0x00020000 .. 0x00050000) */
  version: number
  /** Compiler version that generated this font (version 3.0+; 0 otherwise) */
  compilerVersion: number
  subtables: SilfSubtable[]
}

export function parseSilf(reader: BinaryReader): SilfTable {
  requireGraphiteRange(reader, 0, 4, 'Silf header')
  const version = reader.readUint32()
  if (version < 0x00020000 || version >= 0x00060000) {
    throw new Error(`Unsupported Silf table version: 0x${version.toString(16).padStart(8, '0')}`)
  }

  let r = reader
  let compilerVersion = 0
  if (version >= 0x00030000) {
    requireGraphiteRange(reader, 0, 8, 'Silf extended header')
    const word = reader.readUint32()
    if (version >= 0x00050000) {
      const scheme = word >>> 27
      if (scheme !== 0) {
        r = decompressGraphiteTable(reader, word)
        r.seek(4)
        compilerVersion = r.readUint32() & 0x07ffffff
      } else {
        compilerVersion = word & 0x07ffffff
      }
    } else {
      compilerVersion = word
    }
  }

  requireGraphiteRange(r, r.position, 4, 'Silf subtable directory header')
  const numSub = r.readUint16()
  r.skip(2) // reserved
  requireGraphiteRange(r, r.position, numSub * 4, 'Silf subtable directory')
  const offsets = r.readUint32Array(numSub) // relative to the start of the Silf table
  const directoryEnd = r.position
  for (let i = 0; i < offsets.length; i++) {
    const end = i + 1 < offsets.length ? offsets[i + 1]! : r.length
    if (offsets[i]! < directoryEnd || end <= offsets[i]! || end > r.length) {
      throw new Error('Silf subtable offsets are invalid')
    }
  }

  const subtables: SilfSubtable[] = []
  for (let i = 0; i < numSub; i++) {
    subtables.push(parseSilfSubtable(r, offsets[i]!, i + 1 < numSub ? offsets[i + 1]! : r.length, version))
  }

  return { version, compilerVersion, subtables }
}

function parseSilfSubtable(r: BinaryReader, subStart: number, subEnd: number, version: number): SilfSubtable {
  requireGraphiteRange(r, subStart, (version >= 0x00030000 ? 8 : 0) + 20, 'Silf subtable header')
  r.seek(subStart)

  let ruleVersion = 0
  let passOffset = 0
  let pseudosOffset = 0
  if (version >= 0x00030000) {
    ruleVersion = r.readUint32()
    passOffset = r.readUint16()
    pseudosOffset = r.readUint16()
  }

  const maxGlyphId = r.readUint16()
  const extraAscent = r.readInt16()
  const extraDescent = r.readInt16()
  const numPasses = r.readUint8()
  const iSubst = r.readUint8()
  const iPos = r.readUint8()
  const iJust = r.readUint8()
  const iBidi = r.readUint8()
  const flags = r.readUint8()
  const maxPreContext = r.readUint8()
  const maxPostContext = r.readUint8()
  const attrPseudo = r.readUint8()
  const attrBreakWeight = r.readUint8()
  const attrDirectionality = r.readUint8()
  const attrMirroring = r.readUint8()
  const attrSkipPasses = r.readUint8()

  if (numPasses > 128 || iSubst > iPos || iPos > iJust || iJust > numPasses
    || iBidi !== 0xff && (iBidi < iJust || iBidi > numPasses)) {
    throw new Error('Silf pass boundaries are invalid')
  }

  const numJLevels = r.readUint8()
  requireGraphiteRange(r, r.position, numJLevels * 8 + 10, 'Silf justification data')
  const jLevels: SilfJustificationLevel[] = []
  for (let i = 0; i < numJLevels; i++) {
    const attrStretch = r.readUint8()
    const attrShrink = r.readUint8()
    const attrStep = r.readUint8()
    const attrWeight = r.readUint8()
    const runto = r.readUint8()
    r.skip(3) // reserved
    jLevels.push({ attrStretch, attrShrink, attrStep, attrWeight, runto })
  }

  const numLigComp = r.readUint16()
  const numUserDefn = r.readUint8()
  const maxCompPerLig = r.readUint8()
  const direction = r.readUint8() - 1
  const attCollisions = r.readUint8()
  r.skip(3) // reserved
  const numCritFeatures = r.readUint8()
  requireGraphiteRange(r, r.position, numCritFeatures * 2 + 2, 'Silf critical features')
  const critFeatures = r.readUint16Array(numCritFeatures)
  r.skip(1) // reserved
  const numScriptTag = r.readUint8()
  requireGraphiteRange(r, r.position, numScriptTag * 4 + 2 + (numPasses + 1) * 4 + 8, 'Silf script and pass data')
  const scriptTags: string[] = []
  for (let i = 0; i < numScriptTag; i++) {
    scriptTags.push(r.readTag())
  }
  const lbGID = r.readUint16()
  const oPasses = r.readUint32Array(numPasses + 1) // relative to the subtable start
  const numPseudo = r.readUint16()
  const searchPseudo = r.readUint16()
  const pseudoSelector = r.readUint16()
  const pseudoShift = r.readUint16()
  const pseudoMaps: SilfPseudoMap[] = []
  requireGraphiteRange(r, r.position, numPseudo * 6, 'Silf pseudo map')
  for (let i = 0; i < numPseudo; i++) {
    const unicode = r.readUint32()
    const pseudoGlyph = r.readUint16()
    pseudoMaps.push({ unicode, pseudoGlyph })
  }

  const classMap = parseSilfClassMap(r, version, subEnd)

  for (let i = 0; i < oPasses.length; i++) {
    const absolute = subStart + oPasses[i]!
    if (absolute < r.position || absolute > subEnd
      || i > 0 && oPasses[i]! <= oPasses[i - 1]!) {
      throw new Error('Silf pass offsets are invalid')
    }
  }

  const passes: SilfPass[] = []
  for (let i = 0; i < numPasses; i++) {
    passes.push(parseSilfPass(r, subStart, oPasses[i]!, oPasses[i + 1]!, version))
  }

  return {
    ruleVersion, passOffset, pseudosOffset,
    maxGlyphId, extraAscent, extraDescent,
    numPasses, iSubst, iPos, iJust, iBidi, flags,
    maxPreContext, maxPostContext,
    attrPseudo, attrBreakWeight, attrDirectionality, attrMirroring, attrSkipPasses,
    jLevels, numLigComp, numUserDefn, maxCompPerLig, direction, attCollisions,
    critFeatures, scriptTags, lbGID, oPasses,
    searchPseudo, pseudoSelector, pseudoShift, pseudoMaps,
    classMap, passes,
  }
}

function parseSilfClassMap(r: BinaryReader, version: number, subEnd: number): SilfClassMap {
  const mapStart = r.position
  requireGraphiteRange(r, mapStart, 4, 'Silf class map header')
  const numClass = r.readUint16()
  const numLinear = r.readUint16()

  // Offsets are byte offsets from the start of the class map.
  // ULONG since version 4.0, USHORT before.
  const offsets = new Uint32Array(numClass + 1)
  const offsetWidth = version >= 0x00040000 ? 4 : 2
  requireGraphiteRange(r, r.position, (numClass + 1) * offsetWidth, 'Silf class offsets')
  if (version >= 0x00040000) {
    for (let i = 0; i <= numClass; i++) {
      offsets[i] = r.readUint32()
    }
  } else {
    for (let i = 0; i <= numClass; i++) {
      offsets[i] = r.readUint16()
    }
  }

  const minimumOffset = 4 + (numClass + 1) * offsetWidth
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i]! < minimumOffset || mapStart + offsets[i]! > subEnd
      || i > 0 && offsets[i]! < offsets[i - 1]!) {
      throw new Error('Silf class offsets are invalid')
    }
  }

  const linearClasses: Uint16Array[] = []
  for (let i = 0; i < numLinear; i++) {
    const start = offsets[i]!
    const end = offsets[i + 1]!
    if ((end - start) % 2 !== 0) throw new Error('Silf linear class has an invalid length')
    r.seek(mapStart + start)
    linearClasses.push(r.readUint16Array((end - start) >> 1))
  }

  const lookupClasses: SilfLookupClass[] = []
  for (let i = numLinear; i < numClass; i++) {
    r.seek(mapStart + offsets[i]!)
    if (offsets[i + 1]! - offsets[i]! < 8) throw new Error('Silf lookup class is truncated')
    const numIds = r.readUint16()
    const searchRange = r.readUint16()
    const entrySelector = r.readUint16()
    const rangeShift = r.readUint16()
    const glyphIds = new Uint16Array(numIds)
    const indices = new Uint16Array(numIds)
    if (8 + numIds * 4 > offsets[i + 1]! - offsets[i]!) throw new Error('Silf lookup class entries are truncated')
    for (let j = 0; j < numIds; j++) {
      glyphIds[j] = r.readUint16()
      indices[j] = r.readUint16()
    }
    lookupClasses.push({ numIds, searchRange, entrySelector, rangeShift, glyphIds, indices })
  }

  // Leave the reader positioned at the end of the class map
  r.seek(mapStart + offsets[numClass]!)
  return { numClass, numLinear, offsets, linearClasses, lookupClasses }
}

function parseSilfPass(r: BinaryReader, subStart: number, oPass: number, oPassEnd: number, version: number): SilfPass {
  const passStart = subStart + oPass
  const passEnd = subStart + oPassEnd
  requireGraphiteRange(r, passStart, passEnd - passStart, 'Silf pass')
  if (passEnd - passStart < 40) throw new Error('Silf pass header is truncated')
  r.seek(passStart)

  const flags = r.readUint8()
  const maxRuleLoop = r.readUint8()
  const maxRuleContext = r.readUint8()
  const maxBackup = r.readUint8()
  const numRules = r.readUint16()
  const fsmOffset = r.readUint16()
  const pcCode = r.readUint32() // relative to the subtable start
  const rcCode = r.readUint32()
  const aCode = r.readUint32()
  const oDebug = r.readUint32()

  // fsmOffset is deprecated; the FSM header directly follows the pass header.
  const numRows = r.readUint16()
  const numTransitional = r.readUint16()
  const numSuccess = r.readUint16()
  const numColumns = r.readUint16()
  const numRange = r.readUint16()
  const searchRange = r.readUint16()
  const entrySelector = r.readUint16()
  const rangeShift = r.readUint16()

  if (numTransitional > numRows || numSuccess > numRows
    || numSuccess + numTransitional < numRows || numColumns > 0x7fff
    || numRules !== 0 && (numColumns === 0 || numRange === 0)) {
    throw new Error('Silf pass dimensions are invalid')
  }
  if (r.position + numRange * 6 + (numSuccess + 1) * 2 > passEnd) {
    throw new Error('Silf pass ranges exceed the pass bounds')
  }

  const ranges: SilfPassRange[] = []
  for (let i = 0; i < numRange; i++) {
    const firstId = r.readUint16()
    const lastId = r.readUint16()
    const colId = r.readUint16()
    if (firstId > lastId || colId >= numColumns
      || i > 0 && firstId <= ranges[i - 1]!.lastId) {
      throw new Error('Silf pass glyph ranges are invalid')
    }
    ranges.push({ firstId, lastId, colId })
  }

  const oRuleMap = r.readUint16Array(numSuccess + 1)
  for (let i = 1; i < oRuleMap.length; i++) {
    if (oRuleMap[i]! < oRuleMap[i - 1]!) throw new Error('Silf rule-map offsets are not monotonic')
  }
  if (r.position + oRuleMap[numSuccess]! * 2 > passEnd) throw new Error('Silf rule map exceeds the pass bounds')
  const ruleMap = r.readUint16Array(oRuleMap[numSuccess]!)
  for (let i = 0; i < ruleMap.length; i++) {
    if (ruleMap[i]! >= numRules) throw new Error('Silf rule map references an invalid rule')
  }
  const minRulePreContext = r.readUint8()
  const maxRulePreContext = r.readUint8()
  if (minRulePreContext > maxRulePreContext) throw new Error('Silf pass pre-context bounds are invalid')
  const fixedArrayBytes = (maxRulePreContext - minRulePreContext + 1) * 2
    + numRules * 3 + 3 + (numRules + 1) * 4
    + numTransitional * numColumns * 2 + 1
  if (!Number.isSafeInteger(fixedArrayBytes) || r.position + fixedArrayBytes > passEnd) {
    throw new Error('Silf pass arrays exceed the pass bounds')
  }
  const startStates = r.readUint16Array(maxRulePreContext - minRulePreContext + 1)
  const ruleSortKeys = r.readUint16Array(numRules)
  const rulePreContext = r.readBytes(numRules)
  const collisionThresholdValue = r.readUint8()
  const collisionThreshold = collisionThresholdValue === 0 ? 10 : collisionThresholdValue
  const passConstraintLength = r.readUint16()
  const oConstraints = r.readUint16Array(numRules + 1)
  const oActions = r.readUint16Array(numRules + 1)
  const stateTransitions = r.readUint16Array(numTransitional * numColumns)
  r.skip(1)

  const bytecodeStart = r.position - subStart
  if (pcCode !== bytecodeStart || rcCode !== pcCode + passConstraintLength
    || aCode < rcCode || aCode > oPassEnd || oDebug !== 0 && (oDebug < aCode || oDebug > oPassEnd)) {
    throw new Error('Silf pass bytecode offsets are invalid')
  }
  if (oConstraints[numRules]! > aCode - rcCode || oActions[numRules]! > (oDebug || oPassEnd) - aCode) {
    throw new Error('Silf rule bytecode offsets exceed their blocks')
  }
  for (let i = 1; i < oActions.length; i++) {
    if (oActions[i]! < oActions[i - 1]!) throw new Error('Silf action offsets are not monotonic')
  }

  // Bytecode blocks are located via the explicit subtable-relative offsets
  let passConstraints: Uint8Array = new Uint8Array(0)
  if (pcCode !== 0 && passConstraintLength > 0) {
    r.seek(subStart + pcCode)
    passConstraints = r.readBytes(passConstraintLength)
  }
  let ruleConstraints: Uint8Array = new Uint8Array(0)
  if (rcCode !== 0 && aCode > rcCode) {
    r.seek(subStart + rcCode)
    ruleConstraints = r.readBytes(aCode - rcCode)
  }
  const actionsEnd = oDebug !== 0 ? oDebug : oPassEnd
  let actions: Uint8Array = new Uint8Array(0)
  if (aCode !== 0 && actionsEnd > aCode) {
    r.seek(subStart + aCode)
    actions = r.readBytes(actionsEnd - aCode)
  }

  validateGraphiteBytecode(passConstraints, true, 'pass constraint')
  for (let rule = 0; rule < numRules; rule++) {
    const constraintStart = oConstraints[rule]!
    if (constraintStart !== 0) {
      let nextRule = rule + 1
      while (nextRule < numRules && oConstraints[nextRule] === 0) nextRule++
      const constraintEnd = oConstraints[nextRule]!
      if (constraintStart > constraintEnd || constraintEnd > ruleConstraints.length) {
        throw new Error(`Silf rule ${rule} constraint offsets are out of bounds`)
      }
      validateGraphiteBytecode(ruleConstraints.subarray(constraintStart, constraintEnd), true, `rule ${rule} constraint`)
    }
    const actionStart = oActions[rule]!
    const actionEnd = oActions[rule + 1]!
    if (actionStart > actionEnd || actionEnd > actions.length) {
      throw new Error(`Silf rule ${rule} action offsets are out of bounds`)
    }
    validateGraphiteBytecode(actions.subarray(actionStart, actionEnd), false, `rule ${rule} action`)
  }

  let debug: SilfPassDebug | null = null
  if (oDebug !== 0) {
    r.seek(subStart + oDebug)
    debug = {
      dActions: r.readUint16Array(numRules),
      dStates: r.readUint16Array(numRows - numRules),
      dCols: r.readUint16Array(numRows),
    }
  }

  return {
    flags, maxRuleLoop, maxRuleContext, maxBackup,
    numRules, fsmOffset, pcCode, rcCode, aCode, oDebug,
    numRows, numTransitional, numSuccess, numColumns,
    searchRange, entrySelector, rangeShift,
    ranges, oRuleMap, ruleMap,
    minRulePreContext, maxRulePreContext, startStates,
    ruleSortKeys, rulePreContext, collisionThreshold,
    passConstraintLength, oConstraints, oActions, stateTransitions,
    passConstraints, ruleConstraints, actions, debug,
  }
}

const GRAPHITE_OPCODE_PARAMETER_SIZE = Uint8Array.from([
  0, 1, 1, 2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 3, 1, 0,
  0, 0xff, 2, 1, 1, 1, 1, 2, 2, 2, 3, 2, 2, 3, 3, 0,
  0, 0, 0, 2, 2, 2, 1, 0, 5, 0, 0, 2, 3, 3, 0, 0,
  0, 4, 2,
])

function graphiteOpcodeAllowed(opcode: number, constraint: boolean): boolean {
  if (opcode === 0x1a || opcode === 0x2f || opcode === 0x39 || opcode === 0x3a) return false
  if (constraint) {
    return opcode <= 0x18
      || opcode === 0x22
      || opcode >= 0x28 && opcode <= 0x2e
      || opcode >= 0x30 && opcode <= 0x32
      || opcode === 0x36 || opcode === 0x37
      || opcode >= 0x3c && opcode <= 0x41
  }
  return opcode !== 0x22 && opcode < GRAPHITE_OPCODE_PARAMETER_SIZE.length
}

function validateGraphiteBytecode(code: Uint8Array, constraint: boolean, context: string): void {
  let offset = 0
  let lastOpcode = -1
  while (offset < code.length) {
    const opcodeOffset = offset
    const opcode = code[offset]!
    lastOpcode = opcode
    offset++
    if (opcode >= GRAPHITE_OPCODE_PARAMETER_SIZE.length || !graphiteOpcodeAllowed(opcode, constraint)) {
      throw new Error(`Silf ${context} contains invalid opcode 0x${opcode.toString(16)} at ${opcodeOffset}`)
    }
    let parameterSize = GRAPHITE_OPCODE_PARAMETER_SIZE[opcode]!
    if (parameterSize === 0xff) {
      if (offset >= code.length) throw new Error(`Silf ${context} has a truncated ASSOC opcode at ${opcodeOffset}`)
      parameterSize = 1 + code[offset]!
    }
    if (offset + parameterSize > code.length) {
      throw new Error(`Silf ${context} has a truncated opcode 0x${opcode.toString(16)} at ${opcodeOffset}`)
    }
    offset += parameterSize
  }
  if (code.length !== 0 && lastOpcode !== 0x30 && lastOpcode !== 0x31 && lastOpcode !== 0x32) {
    throw new Error(`Silf ${context} is missing a return opcode`)
  }
}
