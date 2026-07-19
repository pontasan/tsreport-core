/**
 * Unicode vowel constraints (a.k.a. invalid-cluster dotted-circle insertion).
 *
 * Certain independent-vowel + dependent-vowel-sign sequences are prohibited by
 * the Unicode script tables (they never occur in well-formed text). When one
 * appears, mainstream shaping engines insert a dotted circle (U+25CC) after the
 * base so the malformed sequence renders visibly broken rather than silently
 * mis-composing. This is a pre-GSUB text preprocessing step, applied uniformly
 * to the Indic and Universal Shaping Engine scripts, independent of whether the
 * font shapes via GSUB or AAT morx.
 *
 * The table is the per-script constraint set from the Unicode invalid-cluster
 * data (each entry maps a base code point to the set of following code points
 * that trigger a dotted circle). Base code points are disjoint across scripts,
 * so the table is flattened; the one three-code-point rule (Devanagari RA +
 * virama + vowel I) is handled separately.
 */

const DOTTED_CIRCLE = 0x25cc

/** base code point -> following code points that make the pair invalid. */
const VOWEL_CONSTRAINTS = new Map<number, ReadonlySet<number>>([
  // Devanagari
  [0x0905, new Set([0x093a, 0x093b, 0x093e, 0x0945, 0x0946, 0x0949, 0x094a, 0x094b, 0x094c, 0x094f, 0x0956, 0x0957])],
  [0x0906, new Set([0x093a, 0x0945, 0x0946, 0x0947, 0x0948])],
  [0x0909, new Set([0x0941])],
  [0x090f, new Set([0x0945, 0x0946, 0x0947])],
  // Bengali
  [0x0985, new Set([0x09be])],
  [0x098b, new Set([0x09c3])],
  [0x098c, new Set([0x09e2])],
  // Gurmukhi
  [0x0a05, new Set([0x0a3e, 0x0a48, 0x0a4c])],
  [0x0a72, new Set([0x0a3f, 0x0a40, 0x0a47])],
  [0x0a73, new Set([0x0a41, 0x0a42, 0x0a4b])],
  // Gujarati
  [0x0a85, new Set([0x0abe, 0x0ac5, 0x0ac7, 0x0ac8, 0x0ac9, 0x0acb, 0x0acc])],
  [0x0ac5, new Set([0x0abe])],
  // Oriya
  [0x0b05, new Set([0x0b3e])],
  [0x0b0f, new Set([0x0b57])],
  [0x0b13, new Set([0x0b57])],
  // Tamil
  [0x0b85, new Set([0x0bc2])],
  // Telugu
  [0x0c12, new Set([0x0c4c, 0x0c55])],
  [0x0c3f, new Set([0x0c55])],
  [0x0c46, new Set([0x0c55])],
  [0x0c4a, new Set([0x0c55])],
  // Kannada
  [0x0c89, new Set([0x0cbe])],
  [0x0c8b, new Set([0x0cbe])],
  [0x0c92, new Set([0x0ccc])],
  // Malayalam
  [0x0d07, new Set([0x0d57])],
  [0x0d09, new Set([0x0d57])],
  [0x0d0e, new Set([0x0d46])],
  [0x0d12, new Set([0x0d3e, 0x0d57])],
  // Sinhala
  [0x0d85, new Set([0x0dcf, 0x0dd0, 0x0dd1])],
  [0x0d8b, new Set([0x0ddf])],
  [0x0d8f, new Set([0x0ddf])],
  [0x0d94, new Set([0x0ddf])],
  [0x0d8d, new Set([0x0dd8])],
  [0x0d91, new Set([0x0dca, 0x0dd9, 0x0dda, 0x0ddc, 0x0ddd, 0x0dde])],
  // Brahmi
  [0x11005, new Set([0x11038])],
  [0x1100b, new Set([0x1103e])],
  [0x1100f, new Set([0x11042])],
  // Khojki
  [0x11200, new Set([0x1122c, 0x11231, 0x11233])],
  [0x11206, new Set([0x1122c])],
  [0x1122c, new Set([0x11230, 0x11231])],
  [0x11240, new Set([0x1122e])],
  // Khudawadi
  [0x112b0, new Set([0x112e0, 0x112e5, 0x112e6, 0x112e7, 0x112e8])],
  // Tirhuta
  [0x11481, new Set([0x114b0])],
  [0x1148b, new Set([0x114ba])],
  [0x1148d, new Set([0x114ba])],
  [0x114aa, new Set([0x114b5, 0x114b6])],
  // Modi
  [0x11600, new Set([0x11639, 0x1163a])],
  [0x11601, new Set([0x11639, 0x1163a])],
  // Takri
  [0x11680, new Set([0x116ad, 0x116b4, 0x116b5])],
  [0x11686, new Set([0x116b2])],
])

/**
 * Insert a dotted circle (U+25CC) into each invalid vowel sequence in place.
 * The clusters array (per-code-point source counts) tracks the code points; an
 * inserted dotted circle carries no source characters (count 0).
 */
export function applyVowelConstraints(cps: number[], clusters: number[], sourceClusters?: number[]): void {
  let i = 0
  while (i + 1 < cps.length) {
    const cur = cps[i]!
    let insertAfter = -1
    // Devanagari RA + virama + vowel I: the dotted circle goes after the virama.
    if (cur === 0x0930 && cps[i + 1] === 0x094d && i + 2 < cps.length && cps[i + 2] === 0x0907) {
      insertAfter = i + 1
    } else {
      const set = VOWEL_CONSTRAINTS.get(cur)
      if (set !== undefined && set.has(cps[i + 1]!)) insertAfter = i
    }
    if (insertAfter >= 0) {
      cps.splice(insertAfter + 1, 0, DOTTED_CIRCLE)
      clusters.splice(insertAfter + 1, 0, 0)
      if (sourceClusters !== undefined) sourceClusters.splice(insertAfter + 1, 0, sourceClusters[insertAfter]!)
      i = insertAfter + 2
    } else {
      i++
    }
  }
}
