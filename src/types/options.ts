/**
 * Font load options
 */
export interface FontLoadOptions {
  /**
   * Font index for TTC/OTC (default: 0)
   */
  fontIndex?: number
  /** Validate normative OpenType 1.9.1 constraints after decoding. */
  conformance?: 'opentype-1.9.1'
}
