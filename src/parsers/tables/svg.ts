import { BinaryReader } from '../../binary/reader.js'
import { gzipInflate } from '../../compression/inflate.js'

/**
 * SVG table: SVG glyph documents
 * Stores glyphs as SVG documents
 */
export interface SvgTable {
  /** Get the SVG document for the given glyph ID (UTF-8 string) */
  getSvgDocument(glyphId: number): string | null
  /** Whether an SVG document exists for the given glyph ID */
  hasSvgDocument(glyphId: number): boolean
}

interface SvgDocEntry {
  startGlyphID: number
  endGlyphID: number
  svgDocOffset: number
  svgDocLength: number
}

/**
 * Parse the SVG table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/svg
 */
export function parseSvg(reader: BinaryReader): SvgTable {
  if (reader.length < 10) throw new Error('SVG table is shorter than its 10-byte header')
  const version = reader.readUint16()
  const svgDocumentListOffset = reader.readUint32()
  const reserved = reader.readUint32()
  if (version === 0 && reserved !== 0) throw new Error('SVG table reserved field must be zero')
  if (svgDocumentListOffset < 10 || svgDocumentListOffset + 2 > reader.length) {
    throw new Error('SVG table document-list offset is out of range')
  }

  // SVGDocumentList
  reader.seek(svgDocumentListOffset)
  const numEntries = reader.readUint16()
  if (numEntries === 0) throw new Error('SVG document list must contain at least one record')
  const documentDataStart = 2 + numEntries * 12
  if (svgDocumentListOffset + documentDataStart > reader.length) throw new Error('SVG table document records exceed the table length')

  const entries: SvgDocEntry[] = []
  for (let i = 0; i < numEntries; i++) {
    const startGlyphID = reader.readUint16()
    const endGlyphID = reader.readUint16()
    const svgDocOffset = reader.readUint32()
    const svgDocLength = reader.readUint32()
    if (startGlyphID > endGlyphID) throw new Error(`SVG document record ${i} has a reversed glyph range`)
    const previous = entries[entries.length - 1]
    if (previous !== undefined && startGlyphID <= previous.endGlyphID) throw new Error(`SVG document record ${i} overlaps or is not sorted`)
    if (svgDocLength === 0 || svgDocOffset < documentDataStart
      || svgDocOffset > reader.length - svgDocumentListOffset
      || svgDocLength > reader.length - svgDocumentListOffset - svgDocOffset) {
      throw new Error(`SVG document record ${i} data range is out of bounds`)
    }
    entries.push({ startGlyphID, endGlyphID, svgDocOffset, svgDocLength })
  }

  // Cache decoded documents
  const docCache = new Map<number, string>()
  const decoder = new TextDecoder('utf-8', { fatal: true })

  function findEntry(glyphId: number): SvgDocEntry | null {
    // Binary search (entries sorted by startGlyphID)
    let lo = 0
    let hi = entries.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const entry = entries[mid]!
      if (glyphId < entry.startGlyphID) {
        hi = mid - 1
      } else if (glyphId > entry.endGlyphID) {
        lo = mid + 1
      } else {
        return entry
      }
    }
    return null
  }

  function decodeSvg(entry: SvgDocEntry): string {
    const cached = docCache.get(entry.svgDocOffset)
    if (cached !== undefined) return cached

    reader.seek(svgDocumentListOffset + entry.svgDocOffset)
    let bytes = reader.readBytes(entry.svgDocLength)

    // gzip compression check: first 2 bytes are 0x1F 0x8B
    if (bytes.length >= 2 && bytes[0] === 0x1F && bytes[1] === 0x8B) {
      bytes = gzipInflate(bytes)
    }

    const text = decoder.decode(bytes)
    docCache.set(entry.svgDocOffset, text)
    return text
  }

  return {
    getSvgDocument(glyphId: number): string | null {
      const entry = findEntry(glyphId)
      if (!entry) return null
      return decodeSvg(entry)
    },

    hasSvgDocument(glyphId: number): boolean {
      return findEntry(glyphId) !== null
    },
  }
}
