import type { TableDirectoryEntry, HeadTable, HheaTable, MaxpTable, HmtxTable, Os2Table, NameTable, PostTable, LocaTable } from './tables.js'
import type { CmapTable } from './cmap.js'
import type { KernTable } from '../parsers/tables/kern.js'
import type { DsigTable } from '../parsers/tables/dsig.js'

/**
 * Font format type
 */
export type FontFormat = 'ttf' | 'otf' | 'ttc' | 'otc' | 'woff' | 'woff2' | 'eot'

export type WoffMetadataContent = string | WoffMetadataElement

export interface WoffMetadataElement {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly WoffMetadataContent[]
}

export interface WoffMetadataDocument {
  readonly version: '1.0'
  readonly root: WoffMetadataElement
}

export interface WebFontContainerData {
  readonly majorVersion: number
  readonly minorVersion: number
  readonly metadata: string | null
  readonly metadataDocument: WoffMetadataDocument | null
  readonly privateData: Uint8Array | null
}

export interface FontCollectionData {
  readonly majorVersion: 1 | 2
  readonly minorVersion: 0
  readonly fontIndex: number
  readonly numFonts: number
  readonly fontOffsets: Uint32Array
  readonly signature: {
    readonly tag: 'DSIG'
    readonly offset: number
    readonly data: Uint8Array
    readonly table: DsigTable
  } | null
}

/**
 * Internal data structure of an SFNT font
 * Tables are parsed lazily on first access
 */
export interface SfntData {
  /** Format type */
  readonly format: FontFormat
  /** SFNT version (0x00010000=TrueType, 'OTTO'=CFF) */
  readonly sfntVersion: number
  /** Table directory */
  readonly tableDirectory: Map<string, TableDirectoryEntry>
  /** Reference to the source data buffer */
  readonly buffer: ArrayBuffer
  /** Offset within the buffer (for TTC) */
  readonly offsetInBuffer: number
  /** WOFF/WOFF2 container data, absent for raw sfnt fonts. */
  readonly webFontContainer?: WebFontContainerData
  /** TTC/OTC resource metadata, including the collection-level signature. */
  readonly collection?: FontCollectionData
}

/**
 * Cache of parsed tables
 */
export interface ParsedTables {
  head?: HeadTable
  hhea?: HheaTable
  maxp?: MaxpTable
  hmtx?: HmtxTable
  os2?: Os2Table
  name?: NameTable
  post?: PostTable
  cmap?: CmapTable
  loca?: LocaTable
  kern?: KernTable | null
}
