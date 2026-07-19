/**
 * cmap table: Unicode codepoint → glyphId mapping
 */
export interface CmapTable {
  /** All encoding records, including records not selected for Unicode lookup. */
  readonly encodingRecords: readonly CmapEncodingRecord[]

  /** Encoding record selected for the default character-to-glyph mapping. */
  readonly selectedEncoding: CmapEncodingRecord

  /**
   * Get glyphId from a Unicode codepoint
   */
  getGlyphId(codePoint: number): number

  /**
   * Get glyphId with a variation selector (Format 14 UVS)
   * @param codePoint codepoint of the base character
   * @param variationSelector variation selector (U+FE00-U+FE0F, U+E0100-U+E01EF)
   * @returns glyphId (falls back to the regular getGlyphId if not found)
   */
  getGlyphIdWithVariation(codePoint: number, variationSelector: number): number

  /**
   * Resolve only a UVS declared by format 14. Null means that the sequence is
   * not declared; a default UVS returns the base cmap glyph.
   */
  getVariationGlyphId(codePoint: number, variationSelector: number): number | null

  /** Enumerate every default and non-default format-14 variation sequence. */
  variationSequences(): Iterable<CmapVariationSequence>

  /**
   * Iterator over all mapped entries
   */
  entries(): Iterable<[codePoint: number, glyphId: number]>
}

export interface CmapVariationSequence {
  readonly codePoint: number
  readonly variationSelector: number
  readonly glyphId: number
  readonly isDefault: boolean
}

/** A decoded cmap encoding record and its character-code mapping. */
export interface CmapEncodingRecord {
  readonly platformId: number
  readonly encodingId: number
  readonly format: number
  readonly language: number | null
  /** Null only for format 14, whose UVS mapping is exposed by CmapTable. */
  readonly mapping: CmapMapping | null
}

/** Mapping semantics shared by non-format-14 cmap subtables. */
export interface CmapMapping {
  getGlyphId(characterCode: number): number
  getGlyphIdWithVariation(characterCode: number, variationSelector: number): number
  entries(): Iterable<[characterCode: number, glyphId: number]>
}

/**
 * cmap Format 4: BMP characters only (U+0000..U+FFFF)
 */
export interface CmapFormat4Data {
  readonly format: 4
  readonly segCount: number
  readonly endCodes: Uint16Array
  readonly startCodes: Uint16Array
  readonly idDeltas: Int16Array
  readonly idRangeOffsets: Uint16Array
  readonly glyphIdArray: Uint16Array
}

/**
 * cmap Format 12: full Unicode range
 */
export interface CmapFormat12Data {
  readonly format: 12
  readonly groups: CmapFormat12Group[]
}

export interface CmapFormat12Group {
  readonly startCharCode: number
  readonly endCharCode: number
  readonly startGlyphId: number
}
