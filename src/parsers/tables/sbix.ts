import { BinaryReader } from '../../binary/reader.js'

/**
 * sbix glyph bitmap data
 */
export interface SbixGlyphData {
  /** Graphic type (e.g. 'png ', 'jpg ', 'tiff', 'dupe') */
  readonly graphicType: string
  /** Image data (PNG/JPEG/etc binary) */
  readonly data: Uint8Array
  /** Origin offset in the X direction */
  readonly originOffsetX: number
  /** Origin offset in the Y direction */
  readonly originOffsetY: number
}

/**
 * sbix table: Apple Standard Bitmap Graphics
 * Used for color emoji, etc.
 */
export interface SbixTable {
  readonly drawOutlines: boolean
  /** Available strikes, including device pixel density. */
  readonly availableStrikes: readonly { ppem: number; ppi: number }[]
  /** List of available PPEM values */
  readonly availablePpems: readonly number[]
  /** Get the bitmap for the given PPEM, optional PPI, and glyph ID. */
  getGlyphBitmap(glyphId: number, ppem: number, ppi?: number): SbixGlyphData | null
}

/**
 * Parse the sbix table
 * https://learn.microsoft.com/en-us/typography/opentype/spec/sbix
 * @param numGlyphs glyph count from the maxp table
 */
export function parseSbix(reader: BinaryReader, numGlyphs: number): SbixTable {
  if (reader.length < 8) throw new Error('sbix header is truncated')
  const tableStart = 0
  const version = reader.readUint16()
  const flags = reader.readUint16()
  const numStrikes = reader.readUint32()
  if (version < 1) throw new Error(`Unsupported sbix version: ${version}`)
  if ((flags & 1) === 0 || (version === 1 && (flags & 0xFFFC) !== 0)) throw new Error(`sbix flags are invalid: ${flags}`)
  if (numStrikes === 0) throw new Error('sbix requires at least one strike')
  if (numStrikes > Math.floor((reader.length - 8) / 4)) throw new Error('sbix strike offsets exceed table length')

  // Strike offsets (from table start)
  const strikeOffsets: number[] = []
  for (let i = 0; i < numStrikes; i++) {
    const offset = reader.readUint32()
    if (offset > reader.length - 4) throw new Error(`sbix strike ${i} header exceeds table length`)
    if (i > 0 && offset <= strikeOffsets[i - 1]!) throw new Error('sbix strike offsets must be strictly increasing')
    strikeOffsets.push(offset)
  }

  // Parse strike headers to get ppem values
  const strikes: { ppem: number; ppi: number; offset: number }[] = []
  const availablePpems: number[] = []

  for (let i = 0; i < numStrikes; i++) {
    const offset = strikeOffsets[i]!
    reader.seek(offset)
    const ppem = reader.readUint16()
    const ppi = reader.readUint16()
    const strikeEnd = i + 1 < strikeOffsets.length ? strikeOffsets[i + 1]! : reader.length
    const offsetsEnd = offset + 4 + (numGlyphs + 1) * 4
    if (ppem === 0 || ppi === 0) throw new Error('sbix strike ppem and ppi must be non-zero')
    if (offsetsEnd > strikeEnd) throw new Error(`sbix strike ${i} glyph offsets exceed strike data`)
    let previous = offsetsEnd - offset
    for (let glyph = 0; glyph <= numGlyphs; glyph++) {
      const glyphOffset = reader.getUint32At(offset + 4 + glyph * 4)
      if (glyphOffset < previous || glyphOffset > strikeEnd - offset) {
        throw new Error(`sbix strike ${i} glyph data offsets are invalid`)
      }
      previous = glyphOffset
    }
    strikes.push({ ppem, ppi, offset })
    availablePpems.push(ppem)
  }

  return {
    drawOutlines: (flags & 2) !== 0,
    availableStrikes: strikes,
    availablePpems,

    getGlyphBitmap(glyphId: number, ppem: number, ppi?: number): SbixGlyphData | null {
      let strike: { ppem: number; ppi: number; offset: number } | undefined
      for (let i = 0; i < strikes.length; i++) {
        const candidate = strikes[i]!
        if (candidate.ppem === ppem && (ppi === undefined || candidate.ppi === ppi)) {
          strike = candidate
          break
        }
      }
      if (!strike) return null

      if (glyphId < 0 || glyphId >= numGlyphs) return null

      // Strike layout: ppem(2) + ppi(2) + glyphDataOffsets[numGlyphs+1](4 each)
      const offsetsStart = strike.offset + 4 // skip ppem + ppi
      reader.seek(offsetsStart + glyphId * 4)
      const glyphDataOffset = reader.readUint32()
      const nextGlyphDataOffset = reader.readUint32()

      const dataLength = nextGlyphDataOffset - glyphDataOffset
      if (dataLength <= 0) return null // empty glyph

      // GlyphData: originOffsetX(2) + originOffsetY(2) + graphicType(4) + data(...)
      reader.seek(strike.offset + glyphDataOffset)
      const originOffsetX = reader.readInt16()
      const originOffsetY = reader.readInt16()
      const graphicType = reader.readTag()
      if (graphicType !== 'jpg ' && graphicType !== 'png ' && graphicType !== 'tiff' && graphicType !== 'dupe') {
        throw new Error(`Unsupported sbix graphic type '${graphicType}'`)
      }

      const imageDataLength = dataLength - 8 // minus header
      if (imageDataLength <= 0) return null

      const data = reader.readBytes(imageDataLength)
      if (graphicType === 'dupe' && data.length !== 2) throw new Error('sbix dupe data must contain exactly one glyph ID')

      return { graphicType, data, originOffsetX, originOffsetY }
    },
  }
}
