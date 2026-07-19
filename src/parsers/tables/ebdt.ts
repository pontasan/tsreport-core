import { BinaryReader } from '../../binary/reader.js'
import {
  parseBitmapLocationHeader,
  type BitmapSizeRecord,
  type BitmapGlyphData,
} from './bitmap-index.js'
import { readEmbeddedBitmapGlyph } from './embedded-bitmap-data.js'

/** EBDT/EBLC legacy monochrome and grayscale bitmap tables. */
export interface EbdtTable {
  /** Complete strike records, including line metrics and index-table metadata. */
  readonly availableStrikes: readonly BitmapSizeRecord[]
  /** Returns the bitmap for the given glyph ID and PPEM. */
  getGlyphBitmap(glyphId: number, ppemY?: number, ppemX?: number): BitmapGlyphData | null
}

/** Parses paired EBDT/EBLC tables, or the structurally equivalent Apple bdat/bloc pair. */
export function parseEbdt(eblcReader: BinaryReader, ebdtReader: BinaryReader, legacyApple = false): EbdtTable {
  const sizes = parseBitmapLocationHeader(eblcReader, 2, legacyApple)
  if (ebdtReader.length < 4) throw new Error('EBDT header is truncated')
  const majorVersion = ebdtReader.readUint16()
  const minorVersion = ebdtReader.readUint16()
  if (majorVersion !== 2) {
    throw new Error(`EBDT major version must be 2, got ${majorVersion}.${minorVersion}`)
  }

  return {
    availableStrikes: sizes,

    getGlyphBitmap(glyphId: number, ppemY?: number, ppemX?: number): BitmapGlyphData | null {
      const strike = findBestStrike(sizes, ppemY, ppemX)
      return strike === null ? null : readEmbeddedBitmapGlyph(eblcReader, ebdtReader, strike, glyphId, false)
    },
  }
}

function findBestStrike(
  sizes: readonly BitmapSizeRecord[],
  ppemY?: number,
  ppemX?: number,
): BitmapSizeRecord | null {
  if (sizes.length === 0) return null
  if (ppemY === undefined) return sizes[0]!
  const targetX = ppemX ?? ppemY
  let best = sizes[0]!
  let bestDistance = Math.abs(best.ppemY - ppemY) + Math.abs(best.ppemX - targetX)
  for (let i = 1; i < sizes.length; i++) {
    const candidate = sizes[i]!
    const distance = Math.abs(candidate.ppemY - ppemY) + Math.abs(candidate.ppemX - targetX)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}
