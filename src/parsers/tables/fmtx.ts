import { BinaryReader } from '../../binary/reader.js'

/**
 * fmtx table: Font Metrics (Apple Advanced Typography)
 *
 * Header: version(Fixed 2.0) + glyphIndex(4) + 8 point-number bytes.
 * The named points of the referenced glyph define the font-wide metrics
 * (overriding hhea/vhea values).
 */

export interface FmtxTable {
  readonly version: number
  /** Glyph whose points represent the metrics */
  readonly glyphIndex: number
  /** Point number for the horizontal ascent */
  readonly horizontalBefore: number
  /** Point number for the horizontal descent */
  readonly horizontalAfter: number
  /** Point number for the horizontal caret head */
  readonly horizontalCaretHead: number
  /** Point number for the horizontal caret base */
  readonly horizontalCaretBase: number
  /** Point number for the vertical ascent */
  readonly verticalBefore: number
  /** Point number for the vertical descent */
  readonly verticalAfter: number
  /** Point number for the vertical caret head */
  readonly verticalCaretHead: number
  /** Point number for the vertical caret base */
  readonly verticalCaretBase: number
}

export function parseFmtx(reader: BinaryReader, numGlyphs?: number): FmtxTable {
  if (reader.length !== 16) {
    throw new Error(`fmtx table length must be exactly 16 bytes, got ${reader.length}`)
  }
  const rawVersion = reader.readUint32()
  if (rawVersion !== 0x00020000) {
    throw new Error(`Unsupported fmtx table version: 0x${rawVersion.toString(16).padStart(8, '0')}`)
  }
  const glyphIndex = reader.readUint32()
  if (numGlyphs !== undefined && glyphIndex >= numGlyphs) {
    throw new Error(`fmtx glyphIndex ${glyphIndex} exceeds numGlyphs ${numGlyphs}`)
  }
  const horizontalBefore = reader.readUint8()
  const horizontalAfter = reader.readUint8()
  const horizontalCaretHead = reader.readUint8()
  const horizontalCaretBase = reader.readUint8()
  const verticalBefore = reader.readUint8()
  const verticalAfter = reader.readUint8()
  const verticalCaretHead = reader.readUint8()
  const verticalCaretBase = reader.readUint8()

  return {
    version: 2,
    glyphIndex,
    horizontalBefore,
    horizontalAfter,
    horizontalCaretHead,
    horizontalCaretBase,
    verticalBefore,
    verticalAfter,
    verticalCaretHead,
    verticalCaretBase,
  }
}
