import { BinaryReader } from '../../binary/reader.js'
import {
  parseBitmapLocationHeader,
  type BitmapSizeRecord,
  type BitmapGlyphData,
} from './bitmap-index.js'
import { readEmbeddedBitmapGlyph } from './embedded-bitmap-data.js'

/** CBDT/CBLC color bitmap tables. */
export interface CbdtTable {
  /** Complete strike records, including line metrics and index-table metadata. */
  readonly availableStrikes: readonly BitmapSizeRecord[]
  /** Returns the bitmap for the given glyph ID and PPEM. */
  getGlyphBitmap(glyphId: number, ppemY?: number, ppemX?: number): BitmapGlyphData | null
}

/** Parses paired CBDT/CBLC tables, including EBDT-compatible and PNG formats. */
export function parseCbdt(cblcReader: BinaryReader, cbdtReader: BinaryReader): CbdtTable {
  const sizes = parseBitmapLocationHeader(cblcReader, 3)
  if (cbdtReader.length < 4) throw new Error('CBDT header is truncated')
  const majorVersion = cbdtReader.readUint16()
  const minorVersion = cbdtReader.readUint16()
  if (majorVersion !== 3) {
    throw new Error(`CBDT major version must be 3, got ${majorVersion}.${minorVersion}`)
  }

  return {
    availableStrikes: sizes,

    getGlyphBitmap(glyphId: number, ppemY?: number, ppemX?: number): BitmapGlyphData | null {
      const strike = findBestStrike(sizes, ppemY, ppemX)
      return strike === null ? null : readEmbeddedBitmapGlyph(cblcReader, cbdtReader, strike, glyphId, true)
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
