/**
 * Path command type
 * All formats are normalized to cubic Bezier curves
 */
export enum PathCommand {
  MoveTo = 0,    // x, y
  LineTo = 1,    // x, y
  CubicTo = 2,   // cp1x, cp1y, cp2x, cp2y, x, y
  Close = 3,     // (no arguments)
}

/**
 * Number of coordinate values per command
 */
export const PATH_COMMAND_COORDS: Record<PathCommand, number> = {
  [PathCommand.MoveTo]: 2,
  [PathCommand.LineTo]: 2,
  [PathCommand.CubicTo]: 6,
  [PathCommand.Close]: 0,
}

/**
 * Glyph outline data
 * Stored in typed arrays to save memory
 */
export interface GlyphOutline {
  /** Path command sequence */
  readonly commands: Uint8Array
  /** Coordinate values (stored in order, corresponding to commands) */
  readonly coords: Float32Array
}

/**
 * Glyph data
 */
export interface Glyph {
  /** Glyph ID */
  readonly glyphId: number
  /** Outline data (composite glyphs resolved) */
  readonly outline: GlyphOutline
  /** Horizontal advance width (font units) */
  readonly advanceWidth: number
  /** Left side bearing (font units) */
  readonly lsb: number
  /** Bounding box: xMin */
  readonly xMin: number
  /** Bounding box: yMin */
  readonly yMin: number
  /** Bounding box: xMax */
  readonly xMax: number
  /** Bounding box: yMax */
  readonly yMax: number
}
