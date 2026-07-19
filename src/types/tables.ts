/**
 * SFNT table directory entry
 */
export interface TableDirectoryEntry {
  /** Table tag (4-character ASCII) */
  readonly tag: string
  /** Checksum */
  readonly checksum: number
  /** Offset of the table data (bytes) */
  readonly offset: number
  /** Length of the table data (bytes) */
  readonly length: number
}

/**
 * head table
 */
export interface HeadTable {
  readonly majorVersion: number
  readonly minorVersion: number
  readonly fontRevision: number
  readonly checksumAdjustment: number
  readonly magicNumber: number
  readonly flags: number
  readonly unitsPerEm: number
  readonly created: bigint
  readonly modified: bigint
  readonly xMin: number
  readonly yMin: number
  readonly xMax: number
  readonly yMax: number
  readonly macStyle: number
  readonly lowestRecPPEM: number
  readonly fontDirectionHint: number
  readonly indexToLocFormat: number  // 0 = short, 1 = long
  readonly glyphDataFormat: number
}

/**
 * hhea table
 */
export interface HheaTable {
  readonly majorVersion: number
  readonly minorVersion: number
  readonly ascender: number
  readonly descender: number
  readonly lineGap: number
  readonly advanceWidthMax: number
  readonly minLeftSideBearing: number
  readonly minRightSideBearing: number
  readonly xMaxExtent: number
  readonly caretSlopeRise: number
  readonly caretSlopeRun: number
  readonly caretOffset: number
  readonly metricDataFormat: number
  readonly numberOfHMetrics: number
}

/**
 * maxp table
 */
export interface MaxpTable {
  readonly version: number
  readonly numGlyphs: number
  readonly maxPoints?: number
  readonly maxContours?: number
  readonly maxCompositePoints?: number
  readonly maxCompositeContours?: number
  readonly maxZones?: number
  readonly maxTwilightPoints?: number
  readonly maxStorage?: number
  readonly maxFunctionDefs?: number
  readonly maxInstructionDefs?: number
  readonly maxStackElements?: number
  readonly maxSizeOfInstructions?: number
  readonly maxComponentElements?: number
  readonly maxComponentDepth?: number
}

/**
 * hmtx table: horizontal metrics data
 */
export interface HmtxTable {
  readonly numberOfHMetrics: number
  readonly numGlyphs: number
  readonly advanceWidths: Uint16Array
  readonly leftSideBearings: Int16Array
  /** Get advanceWidth for a glyph ID */
  getAdvanceWidth(glyphId: number): number
  /** Get left side bearing for a glyph ID */
  getLsb(glyphId: number): number
}

/**
 * OS/2 table
 */
export interface Os2Table {
  readonly version: number
  readonly avgCharWidth: number
  readonly weightClass: number
  readonly widthClass: number
  readonly fsType: number
  readonly subscriptXSize: number
  readonly subscriptYSize: number
  readonly subscriptXOffset: number
  readonly subscriptYOffset: number
  readonly superscriptXSize: number
  readonly superscriptYSize: number
  readonly superscriptXOffset: number
  readonly superscriptYOffset: number
  readonly strikeoutSize: number
  readonly strikeoutPosition: number
  readonly familyClass: number
  readonly panose: Uint8Array
  readonly unicodeRange1: number
  readonly unicodeRange2: number
  readonly unicodeRange3: number
  readonly unicodeRange4: number
  readonly achVendID: string
  readonly fsSelection: number
  readonly firstCharIndex: number
  readonly lastCharIndex: number
  readonly typoAscender: number
  readonly typoDescender: number
  readonly typoLineGap: number
  readonly winAscent: number
  readonly winDescent: number
  readonly xHeight: number
  readonly capHeight: number
  /** v1+: ulCodePageRange1 (0 when absent) */
  readonly codePageRange1: number
  /** v1+: ulCodePageRange2 (0 when absent) */
  readonly codePageRange2: number
  /** v2+: usDefaultChar (0 when absent) */
  readonly defaultChar: number
  /** v2+: usBreakChar (0 when absent) */
  readonly breakChar: number
  /** v2+: usMaxContext (0 when absent) */
  readonly maxContext: number
  /** v5: usLowerOpticalPointSize in TWIPs (0 when absent) */
  readonly lowerOpticalPointSize: number
  /** v5: usUpperOpticalPointSize in TWIPs (0xFFFF when absent) */
  readonly upperOpticalPointSize: number
}

/**
 * name table record
 */
export interface NameRecord {
  readonly platformId: number
  readonly encodingId: number
  readonly languageId: number
  readonly nameId: number
  /** Decoded string; absent only for uninterpreted/custom data or a legacy Mac record without a usable cmap bridge. */
  readonly value?: string
  /** Original bytes when the platform intentionally has no standard character encoding or no exact decoder is available. */
  readonly rawValue?: Uint8Array
  /** format 1 langTag (only when languageId >= 0x8000) */
  readonly langTag?: string
}

/**
 * name table
 */
export interface NameTable {
  readonly records: NameRecord[]
  /** Look up by nameId, optionally selecting an exact numeric language ID or BCP 47 language tag. */
  getName(nameId: number, language?: number | string): string | undefined
}

/**
 * post table
 */
export interface PostTable {
  readonly version: number
  readonly italicAngle: number
  readonly underlinePosition: number
  readonly underlineThickness: number
  readonly isFixedPitch: number
  readonly minMemType42: number
  readonly maxMemType42: number
  readonly minMemType1: number
  readonly maxMemType1: number
  /** Glyph names supplied or synthesized by formats 1.0, 2.0, 2.5, and 4.0. */
  readonly glyphNames?: readonly (string | null)[]
  /** Composite-font character codes supplied by Apple format 4.0. */
  readonly glyphNameCharacterCodes?: Uint16Array
}

/**
 * loca table: glyph offset array
 */
export interface LocaTable {
  /** Number of addressable glyph records (the table contains one additional terminal offset). */
  readonly numGlyphs: number
  /** Get the offset within the glyf table for a glyph ID */
  getOffset(glyphId: number): number
  /** Get the data length within the glyf table for a glyph ID */
  getLength(glyphId: number): number
}
