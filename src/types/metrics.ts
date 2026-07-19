/**
 * Metrics for the entire font
 */
export interface FontMetrics {
  /** font units per em */
  readonly unitsPerEm: number
  /** Ascender (font units) */
  readonly ascender: number
  /** Descender (font units, usually negative) */
  readonly descender: number
  /** Line gap (font units) */
  readonly lineGap: number
  /** OS/2 clipping ascent (usWinAscent), including MVAR hcla. */
  readonly horizontalClippingAscent: number
  /** OS/2 clipping descent (usWinDescent), including MVAR hcld. */
  readonly horizontalClippingDescent: number
  /** vhea ascender, including MVAR vasc; zero when vhea is absent. */
  readonly verticalAscender: number
  /** vhea descender, including MVAR vdsc; zero when vhea is absent. */
  readonly verticalDescender: number
  /** vhea lineGap, including MVAR vlgp; zero when vhea is absent. */
  readonly verticalLineGap: number
  /** hhea caretSlopeRise, including MVAR hcrs. */
  readonly horizontalCaretSlopeRise: number
  /** hhea caretSlopeRun, including MVAR hcrn. */
  readonly horizontalCaretSlopeRun: number
  /** hhea caretOffset, including MVAR hcof. */
  readonly horizontalCaretOffset: number
  /** vhea caretSlopeRise, including MVAR vcrs; zero when vhea is absent. */
  readonly verticalCaretSlopeRise: number
  /** vhea caretSlopeRun, including MVAR vcrn; zero when vhea is absent. */
  readonly verticalCaretSlopeRun: number
  /** vhea caretOffset, including MVAR vcof; zero when vhea is absent. */
  readonly verticalCaretOffset: number
  /** Cap height (font units, from the OS/2 table) */
  readonly capHeight: number
  /** x-height (font units, from the OS/2 table) */
  readonly xHeight: number
  /** Italic angle (degrees) */
  readonly italicAngle: number
  /** Underline position (font units) */
  readonly underlinePosition: number
  /** Underline thickness (font units) */
  readonly underlineThickness: number
  /** Strikeout position above the baseline (font units, from the OS/2 table) */
  readonly strikeoutPosition: number
  /** Strikeout thickness (font units, from the OS/2 table) */
  readonly strikeoutSize: number
  /** Recommended subscript em width (font units, OS/2 ySubscriptXSize) */
  readonly subscriptXSize: number
  /** Recommended subscript em height (font units, OS/2 ySubscriptYSize) */
  readonly subscriptYSize: number
  /** Subscript baseline shift below the baseline (font units, positive down) */
  readonly subscriptYOffset: number
  /** Subscript horizontal offset (font units, for italic slanting) */
  readonly subscriptXOffset: number
  /** Recommended superscript em width (font units, OS/2 ySuperscriptXSize) */
  readonly superscriptXSize: number
  /** Recommended superscript em height (font units, OS/2 ySuperscriptYSize) */
  readonly superscriptYSize: number
  /** Superscript baseline shift above the baseline (font units, positive up) */
  readonly superscriptYOffset: number
  /** Superscript horizontal offset (font units) */
  readonly superscriptXOffset: number
  /** OS/2 weight class (1..1000), derived from the active wght coordinate when present. */
  readonly weightClass: number
  /** OS/2 width class (1..9), derived from the active wdth coordinate when present. */
  readonly widthClass: number
  /** Whether OS/2 fsSelection USE_TYPO_METRICS selects typo line metrics. */
  readonly useTypographicMetrics: boolean
  /** Whether the active face is oblique rather than a classic italic. */
  readonly isOblique: boolean
  /** Whether the font is bold */
  readonly isBold: boolean
  /** Whether the font is italic */
  readonly isItalic: boolean
  /** Whether the font is monospace */
  readonly isMonospace: boolean
}

/**
 * Text measurement result
 * Units match the fontSize passed to measure() (usually pt)
 */
export interface TextMeasurement {
  /** Text width (pt) */
  readonly width: number
  /** Array of advanceWidth per character (pt) */
  readonly advances: Float64Array
}
