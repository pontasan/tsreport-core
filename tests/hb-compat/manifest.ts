/**
 * Classification manifest for the HarfBuzz shaping compatibility suite.
 *
 * Every case ID in cases.ts must appear in exactly one of the two lists:
 * - ENFORCED: Font.shapeText() output matches hb-shape exactly; asserted strictly.
 * - PENDING: known mismatch against hb-shape. The test asserts that the
 *   mismatch is still present — when an implementation change makes a pending
 *   case match, the test fails and tells you to promote it to ENFORCED.
 *
 * To reclassify after implementation changes, run:
 *   HB_COMPAT_REPORT=1 npx vitest run tests/hb-compat.test.ts
 * which prints per-case match status and diff details.
 */

export const ENFORCED: readonly string[] = [
  'cyrl-serbian-locl',
  'use-java-aksara',
  'use-java-cakra',
  'use-java-pasangan',
  'use-bali-word',
  'use-bali-taling',
  'use-cham-medial',
  'use-cham-final',
  'use-sund-word',
  'use-lana-sakot',
  'use-bugi-word',
  'use-mong-word',
  'use-mong-fvs',
  'latin-avatar-kern',
  'latin-avatar-nokern',
  'latin-office-liga',
  'latin-office-noliga',
  'latin-ffi-liga',
  'latin-ffi-noliga',
  'latin-hello-world',
  'latin-pangram',
  'latin-kern-pairs',
  'latin-punctuation',
  'latin-accents-precomposed',
  'latin-combining-marks',
  'latin-notosans-kern',
  'latin-notosans-liga',
  'num-mixed-symbols',
  'num-math-ascii',
  'num-plain-slash',
  'num-fraction-slash',
  'jp-kanji-katakana',
  'jp-hiragana-punct',
  'jp-halfwidth-katakana',
  'jp-mixed-latin',
  'jp-vert-kanji',
  'jp-vert-punct',
  'jp-vert-choon',
  'ar-word',
  'ar-sentence',
  'ar-lam-alef',
  'ar-isolated-letters',
  'ar-digits',
  'dev-ra-conjuncts',
  'bn-bangla',
  'bn-conjunct-ksha',
  'bn-amar',
  'vf-default-hello',
  'vf-wght700-hello',
  'vf-wght700-kern',
  'cff-wavy',
  'cff-office-liga',
  'cff-kern',
  // Promoted 2026-07-06: cmap format 14 variation selector consumption in
  // shapeText() and the LTR mark-attachment pen-advance compensation
  // (subtractPenAdvance) brought these to exact hb-shape parity.
  'jp-ivs',
  'dev-namaste',
  'th-sawasdee',
  'th-sara-am',
  // Added 2026-07-08: Hebrew RTL GPOS mark attachment uses RTL logical-flow
  // pen compensation, matching hb-shape for niqqud and stacked marks.
  'he-shalom',
  'he-niqqud',
  'he-biblical-marks',
  // Added 2026-07-08: Lao uses the Thai/Lao preprocessing path, including
  // SARA AM decomposition and tone-mark order.
  'lo-sabaidee',
  'lo-tone-marks',
  'lo-sara-am',
  // Promoted 2026-07-06: the point-level composite/phantom rework in the
  // glyph pipeline fixed the combined-axis variation delta evaluation.
  'vf-wght700-wdth875',
  // Promoted 2026-07-06: complex-script shaping engine (src/shaping/) —
  // syllable segmentation, base-consonant detection via would-substitute,
  // initial/final reordering (pre-base matra, reph, pre-base-reordering Ra,
  // Khmer coeng+Ro and pre-base vowels, Myanmar kinzi and medial Ra) and
  // per-glyph feature masks brought these to exact hb-shape parity.
  'dev-kshatriya',
  'dev-hindi',
  'dev-reph',
  'dev-i-matra',
  'km-khmer',
  'my-myanmar',
  'my-mingalaba',
  // Promoted 2026-07-06: gpos.ts mark positioning reworked to the exclusive
  // attachment model — each mark lookup SETS the mark's placement (later
  // lookups overwrite) and records the target; resolveAttachments() then
  // chains offsets through the attachment tree with pen-advance
  // compensation. All 57 cases now match hb-shape exactly.
  'ar-diacritics',
  'th-tone-marks',
  'km-kampuchea',
  // Added 2026-07-08: Unicode 17.0 Joining_Type ranges now cover Syriac and
  // the generic joining path resolves syrc positional forms and marks.
  'sy-word',
  'sy-joining',
  'sy-vowel-marks',
  // Added 2026-07-08: the generic cursive joining path covers additional
  // Unicode joining scripts beyond Arabic/Syriac.
  'nko-script-name',
  'nko-manding',
  'mand-word',
  'mand-marks',
  'adlm-adlam',
  'adlm-mark',
  // Added 2026-07-08: Hangul shaping coverage for precomposed syllables,
  // combining-jamo composition, LV+T composition, and tone-mark reordering.
  'ko-syllables',
  'ko-combining-jamo',
  'ko-lv-t-composition',
  'ko-tone-mark',
  // Added 2026-07-08: Indic coverage for every Indic shaper configuration
  // beyond Devanagari/Bengali. The GPOS null-anchor fix keeps Gurmukhi
  // abvm/mark lookups from attaching marks to absent anchors.
  'pa-gurmukhi-word',
  'pa-conjunct-para',
  'gu-gujarati-word',
  'gu-conjunct-kra',
  'or-odia-word',
  'or-conjunct-kssa',
  'ta-tamil-word',
  'ta-conjunct-kssa',
  'te-telugu-word',
  'te-conjunct-kssa',
  'kn-kannada-word',
  'kn-conjunct-kssa',
  'ml-malayalam-word',
  'ml-conjunct-kssa',
  // Added 2026-07-08: Sinhala now enters the Indic shaper through its own
  // block configuration instead of falling back to the default OT path.
  'si-sinhala-word',
  'si-rakaransaya',
  // Added 2026-07-08: Tibetan runs now use a dedicated stack-local shaper
  // with modified combining-class reordering and the prescribed Tibetan
  // GSUB feature stages.
  'tib-bsgrubs',
  'tib-stacked-vowels',
  'tib-subjoined-sanskrit',
  // Added 2026-07-09: expanded Sinhala / Thai / Lao / Hebrew coverage. These
  // already match hb-shape exactly (yansaya/shri conjuncts, Thai/Lao pre-base
  // SARA E/AE reordering and vowel+tone stacks, Hebrew mark stacking).
  'si-yansaya',
  'si-shri',
  // Added 2026-07-09: Sinhala now runs through the Indic shaper (routing +
  // block classification), so pre-base vowel KOMBUVA reordering and two-part
  // vowel split (U+0DDA/DDC/DDD/DDE -> pre-base + post-base) match hb-shape.
  'si-kombuva',
  'si-split-vowel-o',
  'si-split-vowel-au',
  'si-pre-and-post',
  'th-sara-e',
  'th-sara-ae',
  'th-vowel-tone-stack',
  'th-kiat',
  'lo-sara-e',
  'lo-tone-stack',
  'he-shin-dagesh-dot',
  'he-kaf-holam',
  'he-vayomer',
  'he-meteg',
  // Added 2026-07-09: automatic fractions (C3.4). Digits around U+2044 get
  // numr/dnom/frac via per-glyph masks; matches hb-shape.
  'latin-fraction',
  'latin-fraction-long',
  // Added 2026-07-09: font-aware canonical composition (NFC) in the default
  // shaper. Decomposed base+mark sequences recompose to a precomposed glyph the
  // font has; combining marks first reorder by canonical class.
  'vi-viet-nam',
  'vi-nghieng',
  'latin-decomp-marks',
  'latin-combining-reorder',
  // Added 2026-07-09: complex-cluster stress cases across every complex shaper
  // (deep conjuncts, reph, i-reordering, chillu, coeng stacks, kinzi, Arabic
  // mark stacks + lam-alef ligation). All match hb-shape exactly.
  'dv-complex-conjunct',
  'dv-ra-conjunct',
  'dv-i-reorder',
  'bn-complex-conjunct',
  'ta-pulli',
  'ml-chillu',
  'kn-complex',
  'km-coeng-stack',
  'my-kinzi',
  'ar-multi-mark',
  'ar-lam-alef-context',
  'te-conjunct-stack',
  // Added 2026-07-11: optional typographic features (smcp/onum/zero/sups/ordn)
  // — explicit GSUB single-substitution paths — match hb-shape exactly.
  'cff-smcp',
  'cff-onum',
  'cff-zero',
  'cff-sups',
  'cff-ordn',
  // Added 2026-07-11: alternate substitutions — salt/cvXX and aalt
  // (LookupType 3, first alternate) — match hb-shape exactly.
  'cff-salt',
  'cff-cv01',
  'cff-aalt',
  'use-mong-ba-liga',
  // Added 2026-07-11: reph / arkavattu / ya-phala / addak reordering stress
  // cases (Ra+Virama repositioning and gemination) match hb-shape exactly.
  'dev-reph-dharma',
  'gu-reph-dharma',
  'or-reph-dharma',
  'te-arkavattu-dharma',
  'kn-arkavattu-dharma',
  'bn-yaphala-bya',
  'pa-addak-pakka',
]

/**
 * Known mismatches. When adding new cases, put ones that do not yet match here
 * with an analysis comment; the test will demand promotion as soon as they
 * start matching.
 */
export const PENDING: readonly string[] = []
