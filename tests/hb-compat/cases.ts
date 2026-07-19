/**
 * Declarative case list for the HarfBuzz (hb-shape) shaping compatibility suite.
 *
 * Each case is shaped by both hb-shape (oracle, see generate-expectations.ts)
 * and Font.shapeText(), then compared glyph-by-glyph on
 * glyphId / xAdvance / yAdvance / xOffset / yOffset in font units.
 *
 * Feature fairness model:
 * - `features` is the exact feature set given to Font.shapeText() (it replaces
 *   tsreport's built-in defaults for both GSUB and GPOS).
 * - For hb-shape, every feature in `features` is enabled explicitly and — when
 *   `hbAutoDisable` is not false — every HarfBuzz horizontal/common default
 *   feature NOT present in `features` is disabled explicitly ("-tag"), so both
 *   engines run the same nominal feature set.
 * - Complex-script cases (Indic / Khmer / Myanmar / Thai / Lao / Arabic) set
 *   `hbAutoDisable: false`: hb runs with its full shaper defaults (its
 *   script-specific features cannot be meaningfully disabled) and `features`
 *   lists the equivalent full set for tsreport.
 */

/** HarfBuzz OT shaper default features: common + horizontal (hb-ot-shape.cc). */
export const HB_DEFAULT_FEATURES: readonly string[] = [
  // common_features
  'abvm', 'blwm', 'ccmp', 'locl', 'mark', 'mkmk', 'rlig',
  // horizontal_features
  'calt', 'clig', 'curs', 'dist', 'kern', 'liga', 'rclt',
]

/** Standard set for simple horizontal scripts — identical to hb defaults. */
const BASE: readonly string[] = HB_DEFAULT_FEATURES

/** hb common features only (what hb applies for vertical, plus 'vert'). */
const VERTICAL_COMMON: readonly string[] = [
  'abvm', 'blwm', 'ccmp', 'locl', 'mark', 'mkmk', 'rlig',
]

/** hb Arabic shaper set (positional forms are applied automatically by both engines). */
const ARABIC: readonly string[] = [
  'stch', 'ccmp', 'locl', 'rlig', 'calt', 'liga', 'clig', 'rclt', 'mset',
  'curs', 'dist', 'kern', 'mark', 'mkmk', 'abvm', 'blwm',
]

/** hb Indic shaper set (basic + presentation + positioning). */
const INDIC: readonly string[] = [
  'locl', 'ccmp', 'nukt', 'akhn', 'rphf', 'rkrf', 'pref', 'blwf', 'abvf',
  'half', 'pstf', 'vatu', 'cjct', 'init', 'pres', 'abvs', 'blws', 'psts',
  'haln', 'calt', 'clig', 'rclt', 'dist', 'abvm', 'blwm', 'kern', 'mark', 'mkmk',
]

/** hb Khmer shaper set. */
const KHMER: readonly string[] = [
  'locl', 'ccmp', 'pref', 'blwf', 'abvf', 'pstf', 'cfar',
  'pres', 'abvs', 'blws', 'psts', 'liga', 'clig', 'calt', 'rclt',
  'dist', 'abvm', 'blwm', 'kern', 'mark', 'mkmk',
]

/** hb Myanmar shaper set. */
const MYANMAR: readonly string[] = [
  'locl', 'ccmp', 'rphf', 'pref', 'blwf', 'pstf',
  'pres', 'abvs', 'blws', 'psts', 'liga', 'clig', 'calt', 'rclt',
  'dist', 'abvm', 'blwm', 'kern', 'mark', 'mkmk',
]

/** hb Hangul shaper set. */
const HANGUL: readonly string[] = [
  'locl', 'ccmp', 'ljmo', 'vjmo', 'tjmo', 'rlig', 'liga', 'clig', 'rclt',
  'kern', 'mark', 'mkmk',
]

/** hb Tibetan shaper set (language, substitutions, and mark positioning). */
const TIBETAN: readonly string[] = [
  'locl', 'ccmp', 'abvs', 'blws', 'calt', 'liga',
  'kern', 'abvm', 'blwm', 'mkmk',
]

export interface HbCompatCase {
  /** Stable case ID; also the expectation file name (expectations/<id>.json). */
  id: string
  category: string
  /** Font file name under tests/fixtures/fonts/. */
  font: string
  text: string
  /** Text direction. Default 'ltr'. Maps to shapeText direction horizontal/vertical. */
  direction?: 'ltr' | 'rtl' | 'ttb'
  /** OpenType script tag passed to Font.shapeText(). */
  script?: string
  /** ISO 15924 script tag passed to hb-shape --script. */
  hbScript?: string
  /** OpenType language-system tag for shapeText / BCP-47 tag for hb-shape. */
  language?: string
  hbLanguage?: string
  /** Feature tags applied on both sides (see fairness model above). */
  features: readonly string[]
  /** When false, hb defaults not in `features` are NOT force-disabled. */
  hbAutoDisable?: boolean
  /** Variable font coordinates (setVariation / --variations). */
  variations?: Record<string, number>
}

const ROBOTO = 'Roboto-Regular.ttf'
const NOTO = 'NotoSans-Regular.ttf'
const NOTO_JP = 'NotoSansJP-Regular.otf'
const NOTO_HEBR = 'NotoSansHebrew-Regular.ttf'
const NOTO_AR = 'NotoSansArabic-Regular.ttf'
const NOTO_SYRC = 'NotoSansSyriac-Regular.ttf'
const NOTO_NKO = 'NotoSansNKo-Regular.ttf'
const NOTO_MAND = 'NotoSansMandaic-Regular.ttf'
const NOTO_ADLM = 'NotoSansAdlam-Regular.ttf'
const NOTO_DEVA = 'NotoSansDevanagari-Regular.ttf'
const NOTO_BENG = 'NotoSansBengali-Regular.ttf'
const NOTO_GURU = 'NotoSansGurmukhi-Regular.ttf'
const NOTO_GUJR = 'NotoSansGujarati-Regular.ttf'
const NOTO_ORYA = 'NotoSansOriya-Regular.ttf'
const NOTO_TAML = 'NotoSansTamil-Regular.ttf'
const NOTO_TELU = 'NotoSansTelugu-Regular.ttf'
const NOTO_KNDA = 'NotoSansKannada-Regular.ttf'
const NOTO_MLYM = 'NotoSansMalayalam-Regular.ttf'
const NOTO_SINH = 'NotoSansSinhala-Regular.ttf'
const NOTO_THAI = 'NotoSansThai-Regular.ttf'
const NOTO_LAO = 'NotoSansLao-Regular.ttf'
const NOTO_KHMR = 'NotoSansKhmer-Regular.ttf'
const NOTO_JAVA = 'NotoSansJavanese-Regular.ttf'
const NOTO_BALI = 'NotoSansBalinese-Regular.ttf'
const NOTO_CHAM = 'NotoSansCham-Regular.ttf'
const NOTO_SUND = 'NotoSansSundanese-Regular.ttf'
const NOTO_LANA = 'NotoSansTaiTham-Regular.ttf'
const NOTO_BUGI = 'NotoSansBuginese-Regular.ttf'
const NOTO_MONG = 'NotoSansMongolian-Regular.ttf'

/** hb USE shaper set. */
const USE_FEATURES: readonly string[] = [
  // Topographical isol/init/medi/fina are applied automatically by both engines.
  'locl', 'ccmp', 'nukt', 'akhn', 'rphf', 'pref', 'rkrf', 'abvf', 'blwf',
  'half', 'pstf', 'vatu', 'cjct',
  'abvs', 'blws', 'haln', 'pres', 'psts', 'rlig', 'calt', 'clig', 'liga', 'rclt',
  'dist', 'abvm', 'blwm', 'kern', 'mark', 'mkmk',
]
const NOTO_MYMR = 'NotoSansMyanmar-Regular.ttf'
const NOTO_TIBT = 'NotoSerifTibetan-Regular.ttf'
const NOTO_KR = 'NotoSansKR-Regular.otf'
const NOTO_VF = 'NotoSans-VariableFont_wdth,wght.ttf'
const SOURCE_SANS = 'SourceSans3-Regular.otf'

function without(base: readonly string[], ...tags: string[]): string[] {
  return base.filter((t) => !tags.includes(t))
}

export const CASES: readonly HbCompatCase[] = [
  // ---------------------------------------------------------------- Latin
  { id: 'latin-avatar-kern', category: 'latin', font: ROBOTO, text: 'AVATAR', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-avatar-nokern', category: 'latin', font: ROBOTO, text: 'AVATAR', script: 'latn', hbScript: 'Latn', features: without(BASE, 'kern') },
  { id: 'latin-office-liga', category: 'latin', font: ROBOTO, text: 'office', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-office-noliga', category: 'latin', font: ROBOTO, text: 'office', script: 'latn', hbScript: 'Latn', features: without(BASE, 'liga', 'clig') },
  { id: 'latin-ffi-liga', category: 'latin', font: ROBOTO, text: 'ffi', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-ffi-noliga', category: 'latin', font: ROBOTO, text: 'ffi', script: 'latn', hbScript: 'Latn', features: without(BASE, 'liga', 'clig') },
  { id: 'latin-hello-world', category: 'latin', font: ROBOTO, text: 'Hello World', script: 'latn', hbScript: 'Latn', features: BASE },
  // Automatic fraction: digits around U+2044 get numr/frac/dnom (C3.4).
  { id: 'latin-fraction', category: 'latin', font: ROBOTO, text: '1⁄2', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-fraction-long', category: 'latin', font: ROBOTO, text: '12⁄34', script: 'latn', hbScript: 'Latn', features: BASE },
  // Combining-mark handling on the default shaper: Vietnamese stacked
  // diacritics, decomposed marks, and combining-class reordering.
  { id: 'vi-viet-nam', category: 'latin', font: NOTO, text: 'Việt Nam', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'vi-nghieng', category: 'latin', font: NOTO, text: 'nghiêng', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-decomp-marks', category: 'latin', font: NOTO, text: 'ế', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-combining-reorder', category: 'latin', font: NOTO, text: 'ạ́', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-pangram', category: 'latin', font: ROBOTO, text: 'The quick brown fox jumps over the lazy dog', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-kern-pairs', category: 'latin', font: ROBOTO, text: 'To AV Ta Yo We', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-punctuation', category: 'latin', font: ROBOTO, text: '"Don\'t stop; wait!" (really?)', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-accents-precomposed', category: 'latin', font: ROBOTO, text: 'café naïve résumé', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-combining-marks', category: 'latin', font: ROBOTO, text: 'éàô', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-notosans-kern', category: 'latin', font: NOTO, text: 'AVATAR Wavy', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'latin-notosans-liga', category: 'latin', font: NOTO, text: 'final effigy waffle', script: 'latn', hbScript: 'Latn', features: BASE },

  // OpenType LangSys selection: Serbian Cyrillic locl differs from the default form.
  { id: 'cyrl-serbian-locl', category: 'language', font: NOTO, text: 'б', script: 'cyrl', hbScript: 'Cyrl', language: 'SRB ', hbLanguage: 'sr', features: BASE },

  // ------------------------------------------------------ Numbers / symbols
  { id: 'num-mixed-symbols', category: 'numeric', font: ROBOTO, text: 'Order #42: $19.99 (50%)', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'num-math-ascii', category: 'numeric', font: ROBOTO, text: '1+2=3 <x> [y] {z}', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'num-plain-slash', category: 'numeric', font: ROBOTO, text: '1/2 3/4', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'num-fraction-slash', category: 'numeric', font: ROBOTO, text: '1⁄2', script: 'latn', hbScript: 'Latn', features: [...BASE, 'frac', 'numr', 'dnom'] },

  // --------------------------------------------- Complex-cluster stress cases
  { id: 'dv-complex-conjunct', category: 'devanagari', font: NOTO_DEVA, text: 'क्ष्ण', script: 'dev2', hbScript: 'Deva', features: INDIC, hbAutoDisable: false },
  { id: 'dv-ra-conjunct', category: 'devanagari', font: NOTO_DEVA, text: 'र्ष्ट्र', script: 'dev2', hbScript: 'Deva', features: INDIC, hbAutoDisable: false },
  { id: 'dv-i-reorder', category: 'devanagari', font: NOTO_DEVA, text: 'कि', script: 'dev2', hbScript: 'Deva', features: INDIC, hbAutoDisable: false },
  { id: 'bn-complex-conjunct', category: 'bengali', font: NOTO_BENG, text: 'ক্ষ্ম', script: 'bng2', hbScript: 'Beng', features: INDIC, hbAutoDisable: false },
  { id: 'ta-pulli', category: 'tamil', font: NOTO_TAML, text: 'நக்ஷத்ரம்', script: 'tml2', hbScript: 'Taml', features: INDIC, hbAutoDisable: false },
  { id: 'ml-chillu', category: 'malayalam', font: NOTO_MLYM, text: 'നന്‍മ', script: 'mlm2', hbScript: 'Mlym', features: INDIC, hbAutoDisable: false },
  { id: 'kn-complex', category: 'kannada', font: NOTO_KNDA, text: 'ಕ್ಷ್ಣ', script: 'knd2', hbScript: 'Knda', features: INDIC, hbAutoDisable: false },
  { id: 'km-coeng-stack', category: 'khmer', font: NOTO_KHMR, text: 'ស្ត្រី', script: 'khmr', hbScript: 'Khmr', features: KHMER, hbAutoDisable: false },
  { id: 'my-kinzi', category: 'myanmar', font: NOTO_MYMR, text: 'င်္က', script: 'mym2', hbScript: 'Mymr', features: MYANMAR, hbAutoDisable: false },
  { id: 'ar-multi-mark', category: 'arabic', font: NOTO_AR, text: 'مُحَمَّدٌ', direction: 'rtl', script: 'arab', hbScript: 'Arab', features: ARABIC },
  { id: 'ar-lam-alef-context', category: 'arabic', font: NOTO_AR, text: 'الله', direction: 'rtl', script: 'arab', hbScript: 'Arab', features: ARABIC },
  { id: 'te-conjunct-stack', category: 'telugu', font: NOTO_TELU, text: 'స్త్రీ', script: 'tel2', hbScript: 'Telu', features: INDIC, hbAutoDisable: false },

  // ------------------------------------------------------------- Japanese
  { id: 'jp-kanji-katakana', category: 'japanese', font: NOTO_JP, text: '日本語テキスト', script: 'hani', hbScript: 'Hani', features: BASE },
  { id: 'jp-hiragana-punct', category: 'japanese', font: NOTO_JP, text: 'こんにちは、世界。', script: 'kana', hbScript: 'Kana', features: BASE },
  { id: 'jp-halfwidth-katakana', category: 'japanese', font: NOTO_JP, text: 'ｱｲｳｴｵ', script: 'kana', hbScript: 'Kana', features: BASE },
  { id: 'jp-mixed-latin', category: 'japanese', font: NOTO_JP, text: '第1章 Section', script: 'hani', hbScript: 'Hani', features: BASE },
  { id: 'jp-ivs', category: 'japanese', font: NOTO_JP, text: '葛\u{E0100}城', script: 'hani', hbScript: 'Hani', features: BASE },
  { id: 'jp-vert-kanji', category: 'japanese', font: NOTO_JP, text: '日本語テキスト', direction: 'ttb', script: 'hani', hbScript: 'Hani', features: VERTICAL_COMMON },
  { id: 'jp-vert-punct', category: 'japanese', font: NOTO_JP, text: '「縦書き。」', direction: 'ttb', script: 'kana', hbScript: 'Kana', features: VERTICAL_COMMON },
  { id: 'jp-vert-choon', category: 'japanese', font: NOTO_JP, text: 'テーブル', direction: 'ttb', script: 'kana', hbScript: 'Kana', features: VERTICAL_COMMON },

  // --------------------------------------------------------------- Hebrew
  { id: 'he-shalom', category: 'hebrew', font: NOTO_HEBR, text: 'שלום', direction: 'rtl', script: 'hebr', hbScript: 'Hebr', features: BASE },
  { id: 'he-niqqud', category: 'hebrew', font: NOTO_HEBR, text: 'שָׁלוֹם', direction: 'rtl', script: 'hebr', hbScript: 'Hebr', features: BASE },
  { id: 'he-biblical-marks', category: 'hebrew', font: NOTO_HEBR, text: 'בְּרֵאשִׁית', direction: 'rtl', script: 'hebr', hbScript: 'Hebr', features: BASE },

  // --------------------------------------------------------------- Arabic
  { id: 'ar-word', category: 'arabic', font: NOTO_AR, text: 'العربية', direction: 'rtl', script: 'arab', hbScript: 'Arab', features: ARABIC, hbAutoDisable: false },
  { id: 'ar-sentence', category: 'arabic', font: NOTO_AR, text: 'مرحبا بالعالم', direction: 'rtl', script: 'arab', hbScript: 'Arab', features: ARABIC, hbAutoDisable: false },
  { id: 'ar-lam-alef', category: 'arabic', font: NOTO_AR, text: 'لا لآ لأ', direction: 'rtl', script: 'arab', hbScript: 'Arab', features: ARABIC, hbAutoDisable: false },
  { id: 'ar-diacritics', category: 'arabic', font: NOTO_AR, text: 'مُحَمَّد', direction: 'rtl', script: 'arab', hbScript: 'Arab', features: ARABIC, hbAutoDisable: false },
  { id: 'ar-isolated-letters', category: 'arabic', font: NOTO_AR, text: 'ا ب ت', direction: 'rtl', script: 'arab', hbScript: 'Arab', features: ARABIC, hbAutoDisable: false },
  { id: 'ar-digits', category: 'arabic', font: NOTO_AR, text: '١٢٣٤٥', direction: 'rtl', script: 'arab', hbScript: 'Arab', features: ARABIC, hbAutoDisable: false },

  // --------------------------------------------------------------- Syriac
  { id: 'sy-word', category: 'syriac', font: NOTO_SYRC, text: 'ܫܠܡܐ', direction: 'rtl', script: 'syrc', hbScript: 'Syrc', features: ARABIC, hbAutoDisable: false },
  { id: 'sy-joining', category: 'syriac', font: NOTO_SYRC, text: 'ܒܫܡܐ', direction: 'rtl', script: 'syrc', hbScript: 'Syrc', features: ARABIC, hbAutoDisable: false },
  { id: 'sy-vowel-marks', category: 'syriac', font: NOTO_SYRC, text: 'ܫܠܵܡܵܐ', direction: 'rtl', script: 'syrc', hbScript: 'Syrc', features: ARABIC, hbAutoDisable: false },

  // ------------------------------------------------------------------- NKo
  { id: 'nko-script-name', category: 'nko', font: NOTO_NKO, text: 'ߒߞߏ', direction: 'rtl', script: 'nko ', hbScript: 'Nkoo', features: ARABIC, hbAutoDisable: false },
  { id: 'nko-manding', category: 'nko', font: NOTO_NKO, text: 'ߡߊ߲߬ߘߋ߲', direction: 'rtl', script: 'nko ', hbScript: 'Nkoo', features: ARABIC, hbAutoDisable: false },

  // --------------------------------------------------------------- Mandaic
  { id: 'mand-word', category: 'mandaic', font: NOTO_MAND, text: 'ࡌࡀࡍࡃࡀ', direction: 'rtl', script: 'mand', hbScript: 'Mand', features: ARABIC, hbAutoDisable: false },
  { id: 'mand-marks', category: 'mandaic', font: NOTO_MAND, text: 'ࡌࡀࡍࡃࡀ࡙', direction: 'rtl', script: 'mand', hbScript: 'Mand', features: ARABIC, hbAutoDisable: false },

  // ---------------------------------------------------------------- Adlam
  { id: 'adlm-adlam', category: 'adlam', font: NOTO_ADLM, text: '𞤀𞤣𞤤𞤢𞤥', direction: 'rtl', script: 'adlm', hbScript: 'Adlm', features: ARABIC, hbAutoDisable: false },
  { id: 'adlm-mark', category: 'adlam', font: NOTO_ADLM, text: '𞤀𞤣𞤢𞥄', direction: 'rtl', script: 'adlm', hbScript: 'Adlm', features: ARABIC, hbAutoDisable: false },

  // ----------------------------------------------------------- Devanagari
  { id: 'dev-namaste', category: 'devanagari', font: NOTO_DEVA, text: 'नमस्ते', script: 'dev2', hbScript: 'Deva', features: INDIC, hbAutoDisable: false },
  { id: 'dev-kshatriya', category: 'devanagari', font: NOTO_DEVA, text: 'क्षत्रिय', script: 'dev2', hbScript: 'Deva', features: INDIC, hbAutoDisable: false },
  { id: 'dev-hindi', category: 'devanagari', font: NOTO_DEVA, text: 'हिन्दी', script: 'dev2', hbScript: 'Deva', features: INDIC, hbAutoDisable: false },
  { id: 'dev-ra-conjuncts', category: 'devanagari', font: NOTO_DEVA, text: 'प्र क्र', script: 'dev2', hbScript: 'Deva', features: INDIC, hbAutoDisable: false },
  { id: 'dev-reph', category: 'devanagari', font: NOTO_DEVA, text: 'धर्म', script: 'dev2', hbScript: 'Deva', features: INDIC, hbAutoDisable: false },
  { id: 'dev-i-matra', category: 'devanagari', font: NOTO_DEVA, text: 'किताब', script: 'dev2', hbScript: 'Deva', features: INDIC, hbAutoDisable: false },

  // -------------------------------------------------------------- Bengali
  { id: 'bn-bangla', category: 'bengali', font: NOTO_BENG, text: 'বাংলা', script: 'bng2', hbScript: 'Beng', features: INDIC, hbAutoDisable: false },
  { id: 'bn-conjunct-ksha', category: 'bengali', font: NOTO_BENG, text: 'ক্ষ', script: 'bng2', hbScript: 'Beng', features: INDIC, hbAutoDisable: false },
  { id: 'bn-amar', category: 'bengali', font: NOTO_BENG, text: 'আমার', script: 'bng2', hbScript: 'Beng', features: INDIC, hbAutoDisable: false },

  // ------------------------------------------------------------ Gurmukhi
  { id: 'pa-gurmukhi-word', category: 'gurmukhi', font: NOTO_GURU, text: 'ਪੰਜਾਬੀ', script: 'gur2', hbScript: 'Guru', features: INDIC, hbAutoDisable: false },
  { id: 'pa-conjunct-para', category: 'gurmukhi', font: NOTO_GURU, text: 'ਪ੍ਰ', script: 'gur2', hbScript: 'Guru', features: INDIC, hbAutoDisable: false },

  // ------------------------------------------------------------ Gujarati
  { id: 'gu-gujarati-word', category: 'gujarati', font: NOTO_GUJR, text: 'ગુજરાતી', script: 'gjr2', hbScript: 'Gujr', features: INDIC, hbAutoDisable: false },
  { id: 'gu-conjunct-kra', category: 'gujarati', font: NOTO_GUJR, text: 'ક્ર', script: 'gjr2', hbScript: 'Gujr', features: INDIC, hbAutoDisable: false },

  // --------------------------------------------------------------- Oriya
  { id: 'or-odia-word', category: 'oriya', font: NOTO_ORYA, text: 'ଓଡ଼ିଆ', script: 'ory2', hbScript: 'Orya', features: INDIC, hbAutoDisable: false },
  { id: 'or-conjunct-kssa', category: 'oriya', font: NOTO_ORYA, text: 'କ୍ଷ', script: 'ory2', hbScript: 'Orya', features: INDIC, hbAutoDisable: false },

  // --------------------------------------------------------------- Tamil
  { id: 'ta-tamil-word', category: 'tamil', font: NOTO_TAML, text: 'தமிழ்', script: 'tml2', hbScript: 'Taml', features: INDIC, hbAutoDisable: false },
  { id: 'ta-conjunct-kssa', category: 'tamil', font: NOTO_TAML, text: 'க்ஷ', script: 'tml2', hbScript: 'Taml', features: INDIC, hbAutoDisable: false },

  // -------------------------------------------------------------- Telugu
  { id: 'te-telugu-word', category: 'telugu', font: NOTO_TELU, text: 'తెలుగు', script: 'tel2', hbScript: 'Telu', features: INDIC, hbAutoDisable: false },
  { id: 'te-conjunct-kssa', category: 'telugu', font: NOTO_TELU, text: 'క్ష', script: 'tel2', hbScript: 'Telu', features: INDIC, hbAutoDisable: false },

  // ------------------------------------------------------------- Kannada
  { id: 'kn-kannada-word', category: 'kannada', font: NOTO_KNDA, text: 'ಕನ್ನಡ', script: 'knd2', hbScript: 'Knda', features: INDIC, hbAutoDisable: false },
  { id: 'kn-conjunct-kssa', category: 'kannada', font: NOTO_KNDA, text: 'ಕ್ಷ', script: 'knd2', hbScript: 'Knda', features: INDIC, hbAutoDisable: false },

  // ---------------------------- Reph / arkavattu reordering stress cases
  // "dharma" spelled in each script exercises Ra+Virama forming a reph (or
  // arkavattu in Kannada/Telugu) that reorders to the syllable end/top — a
  // shaping path the conjunct cases above do not cover.
  { id: 'dev-reph-dharma', category: 'devanagari', font: NOTO_DEVA, text: 'धर्म', script: 'dev2', hbScript: 'Deva', features: INDIC, hbAutoDisable: false },
  { id: 'gu-reph-dharma', category: 'gujarati', font: NOTO_GUJR, text: 'ધર્મ', script: 'gjr2', hbScript: 'Gujr', features: INDIC, hbAutoDisable: false },
  { id: 'or-reph-dharma', category: 'oriya', font: NOTO_ORYA, text: 'ଧର୍ମ', script: 'ory2', hbScript: 'Orya', features: INDIC, hbAutoDisable: false },
  { id: 'te-arkavattu-dharma', category: 'telugu', font: NOTO_TELU, text: 'ధర్మ', script: 'tel2', hbScript: 'Telu', features: INDIC, hbAutoDisable: false },
  { id: 'kn-arkavattu-dharma', category: 'kannada', font: NOTO_KNDA, text: 'ಧರ್ಮ', script: 'knd2', hbScript: 'Knda', features: INDIC, hbAutoDisable: false },
  { id: 'bn-yaphala-bya', category: 'bengali', font: NOTO_BENG, text: 'ব্য', script: 'bng2', hbScript: 'Beng', features: INDIC, hbAutoDisable: false },
  { id: 'pa-addak-pakka', category: 'gurmukhi', font: NOTO_GURU, text: 'ਪੱਕਾ', script: 'gur2', hbScript: 'Guru', features: INDIC, hbAutoDisable: false },

  // ----------------------------------------------------------- Malayalam
  { id: 'ml-malayalam-word', category: 'malayalam', font: NOTO_MLYM, text: 'മലയാളം', script: 'mlm2', hbScript: 'Mlym', features: INDIC, hbAutoDisable: false },
  { id: 'ml-conjunct-kssa', category: 'malayalam', font: NOTO_MLYM, text: 'ക്ഷ', script: 'mlm2', hbScript: 'Mlym', features: INDIC, hbAutoDisable: false },

  // --------------------------------------------------------------- Sinhala
  { id: 'si-sinhala-word', category: 'sinhala', font: NOTO_SINH, text: 'සිංහල', script: 'sinh', hbScript: 'Sinh', features: INDIC, hbAutoDisable: false },
  { id: 'si-rakaransaya', category: 'sinhala', font: NOTO_SINH, text: 'ක්‍ර', script: 'sinh', hbScript: 'Sinh', features: INDIC, hbAutoDisable: false },
  // Pre-base vowel sign KOMBUVA reorders before its consonant.
  { id: 'si-kombuva', category: 'sinhala', font: NOTO_SINH, text: 'කෙ', script: 'sinh', hbScript: 'Sinh', features: INDIC, hbAutoDisable: false },
  // Two-part vowel KOMBUVA HAA AELA-PILLA splits around the consonant.
  { id: 'si-split-vowel-o', category: 'sinhala', font: NOTO_SINH, text: 'කො', script: 'sinh', hbScript: 'Sinh', features: INDIC, hbAutoDisable: false },
  { id: 'si-split-vowel-au', category: 'sinhala', font: NOTO_SINH, text: 'කෞ', script: 'sinh', hbScript: 'Sinh', features: INDIC, hbAutoDisable: false },
  // Yansaya (subjoined ya) and shri (rakaransaya + vowel).
  { id: 'si-yansaya', category: 'sinhala', font: NOTO_SINH, text: 'ක්‍ය', script: 'sinh', hbScript: 'Sinh', features: INDIC, hbAutoDisable: false },
  { id: 'si-shri', category: 'sinhala', font: NOTO_SINH, text: 'ශ්‍රී', script: 'sinh', hbScript: 'Sinh', features: INDIC, hbAutoDisable: false },
  { id: 'si-pre-and-post', category: 'sinhala', font: NOTO_SINH, text: 'මෙන්', script: 'sinh', hbScript: 'Sinh', features: INDIC, hbAutoDisable: false },

  // ----------------------------------------------------------------- Thai
  { id: 'th-sawasdee', category: 'thai', font: NOTO_THAI, text: 'สวัสดี', script: 'thai', hbScript: 'Thai', features: BASE, hbAutoDisable: false },
  { id: 'th-tone-marks', category: 'thai', font: NOTO_THAI, text: 'น้ำใจ', script: 'thai', hbScript: 'Thai', features: BASE, hbAutoDisable: false },
  { id: 'th-sara-am', category: 'thai', font: NOTO_THAI, text: 'ทำ', script: 'thai', hbScript: 'Thai', features: BASE, hbAutoDisable: false },
  // Pre-base vowel SARA E/AE reorders before the consonant.
  { id: 'th-sara-e', category: 'thai', font: NOTO_THAI, text: 'เก', script: 'thai', hbScript: 'Thai', features: BASE, hbAutoDisable: false },
  { id: 'th-sara-ae', category: 'thai', font: NOTO_THAI, text: 'แสง', script: 'thai', hbScript: 'Thai', features: BASE, hbAutoDisable: false },
  // Above-base vowel + tone mark stack (SARA I + MAI EK).
  { id: 'th-vowel-tone-stack', category: 'thai', font: NOTO_THAI, text: 'ปิ่น', script: 'thai', hbScript: 'Thai', features: BASE, hbAutoDisable: false },
  { id: 'th-kiat', category: 'thai', font: NOTO_THAI, text: 'เกียรติ', script: 'thai', hbScript: 'Thai', features: BASE, hbAutoDisable: false },

  // ------------------------------------------------------------------ Lao
  { id: 'lo-sabaidee', category: 'lao', font: NOTO_LAO, text: 'ສະບາຍດີ', script: 'lao ', hbScript: 'Laoo', features: BASE, hbAutoDisable: false },
  { id: 'lo-tone-marks', category: 'lao', font: NOTO_LAO, text: 'ນ້ຳໃຈ', script: 'lao ', hbScript: 'Laoo', features: BASE, hbAutoDisable: false },
  { id: 'lo-sara-am', category: 'lao', font: NOTO_LAO, text: 'ທຳ', script: 'lao ', hbScript: 'Laoo', features: BASE, hbAutoDisable: false },
  // Pre-base vowels reorder; tone + vowel stacks.
  { id: 'lo-sara-e', category: 'lao', font: NOTO_LAO, text: 'ເມືອງ', script: 'lao ', hbScript: 'Laoo', features: BASE, hbAutoDisable: false },
  { id: 'lo-tone-stack', category: 'lao', font: NOTO_LAO, text: 'ກ່ຽວ', script: 'lao ', hbScript: 'Laoo', features: BASE, hbAutoDisable: false },

  // --------------------------------------------------------------- Hebrew
  // Mark stacking: shin + dagesh + shin-dot; vowels + cantillation.
  { id: 'he-shin-dagesh-dot', category: 'hebrew', font: NOTO_HEBR, text: 'שּׁ', direction: 'rtl', script: 'hebr', hbScript: 'Hebr', features: BASE },
  { id: 'he-kaf-holam', category: 'hebrew', font: NOTO_HEBR, text: 'כֹּה', direction: 'rtl', script: 'hebr', hbScript: 'Hebr', features: BASE },
  { id: 'he-vayomer', category: 'hebrew', font: NOTO_HEBR, text: 'וַיֹּאמֶר', direction: 'rtl', script: 'hebr', hbScript: 'Hebr', features: BASE },
  { id: 'he-meteg', category: 'hebrew', font: NOTO_HEBR, text: 'הַֽמַּיִם', direction: 'rtl', script: 'hebr', hbScript: 'Hebr', features: BASE },

  // ------------------------------------------------------------------ USE
  { id: 'use-java-aksara', category: 'use', font: NOTO_JAVA, text: '\uA9A7\uA9BA\uA9A4', script: 'java', hbScript: 'Java', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-java-cakra', category: 'use', font: NOTO_JAVA, text: '\uA98F\uA9BF\uA9B6', script: 'java', hbScript: 'Java', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-java-pasangan', category: 'use', font: NOTO_JAVA, text: '\uA9A0\uA9C0\uA98F\uA9B8', script: 'java', hbScript: 'Java', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-bali-word', category: 'use', font: NOTO_BALI, text: '\u1B29\u1B38\u1B2B\u1B44\u1B24\u1B3E', script: 'bali', hbScript: 'Bali', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-bali-taling', category: 'use', font: NOTO_BALI, text: '\u1B13\u1B3E\u1B32\u1B38', script: 'bali', hbScript: 'Bali', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-cham-medial', category: 'use', font: NOTO_CHAM, text: '\uAA06\uAA34\uAA2F\uAA22', script: 'cham', hbScript: 'Cham', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-cham-final', category: 'use', font: NOTO_CHAM, text: '\uAA0E\uAA2A\uAA4D', script: 'cham', hbScript: 'Cham', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-sund-word', category: 'use', font: NOTO_SUND, text: '\u1B98\u1BA5\u1B94\u1BAA', script: 'sund', hbScript: 'Sund', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-lana-sakot', category: 'use', font: NOTO_LANA, text: '\u1A20\u1A60\u1A32\u1A6E', script: 'lana', hbScript: 'Lana', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-bugi-word', category: 'use', font: NOTO_BUGI, text: '\u1A00\u1A19\u1A01\u1A17', script: 'bugi', hbScript: 'Bugi', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-mong-word', category: 'use', font: NOTO_MONG, text: '\u182E\u1823\u1829\u182D\u1823\u182F', script: 'mong', hbScript: 'Mong', features: USE_FEATURES, hbAutoDisable: false },
  { id: 'use-mong-fvs', category: 'use', font: NOTO_MONG, text: '\u1820\u180B\u1821', script: 'mong', hbScript: 'Mong', features: USE_FEATURES, hbAutoDisable: false },
  // BA-initial word ligation (BA+A / BA+I merge into single glyphs). Note: the
  // font's calt/rclt ReverseChainSingleSubst (LookupType 8) needs pre-narrowed
  // lookahead variants that plain text does not produce; the type-8 path is
  // covered by the synthetic-GSUB unit tests in gsub.test.ts instead.
  { id: 'use-mong-ba-liga', category: 'use', font: NOTO_MONG, text: '\u182A\u1820\u182A\u1822', script: 'mong', hbScript: 'Mong', features: USE_FEATURES, hbAutoDisable: false },

  // ---------------------------------------------------------------- Khmer
  { id: 'km-khmer', category: 'khmer', font: NOTO_KHMR, text: 'ខ្មែរ', script: 'khmr', hbScript: 'Khmr', features: KHMER, hbAutoDisable: false },
  { id: 'km-kampuchea', category: 'khmer', font: NOTO_KHMR, text: 'កម្ពុជា', script: 'khmr', hbScript: 'Khmr', features: KHMER, hbAutoDisable: false },

  // -------------------------------------------------------------- Myanmar
  { id: 'my-myanmar', category: 'myanmar', font: NOTO_MYMR, text: 'မြန်မာ', script: 'mym2', hbScript: 'Mymr', features: MYANMAR, hbAutoDisable: false },
  { id: 'my-mingalaba', category: 'myanmar', font: NOTO_MYMR, text: 'မင်္ဂလာပါ', script: 'mym2', hbScript: 'Mymr', features: MYANMAR, hbAutoDisable: false },

  // -------------------------------------------------------------- Tibetan
  { id: 'tib-bsgrubs', category: 'tibetan', font: NOTO_TIBT, text: 'བསྒྲུབས་', script: 'tibt', hbScript: 'Tibt', features: TIBETAN, hbAutoDisable: false },
  { id: 'tib-stacked-vowels', category: 'tibetan', font: NOTO_TIBT, text: 'ཨཱོཾ', script: 'tibt', hbScript: 'Tibt', features: TIBETAN, hbAutoDisable: false },
  { id: 'tib-subjoined-sanskrit', category: 'tibetan', font: NOTO_TIBT, text: 'རྐྵིཾ', script: 'tibt', hbScript: 'Tibt', features: TIBETAN, hbAutoDisable: false },

  // ---------------------------------------------------------------- Hangul
  { id: 'ko-syllables', category: 'hangul', font: NOTO_KR, text: '한글테스트', script: 'hang', hbScript: 'Hang', features: HANGUL, hbAutoDisable: false },
  { id: 'ko-combining-jamo', category: 'hangul', font: NOTO_KR, text: '한글', script: 'hang', hbScript: 'Hang', features: HANGUL, hbAutoDisable: false },
  { id: 'ko-lv-t-composition', category: 'hangul', font: NOTO_KR, text: '각', script: 'hang', hbScript: 'Hang', features: HANGUL, hbAutoDisable: false },
  { id: 'ko-tone-mark', category: 'hangul', font: NOTO_KR, text: '가〮', script: 'hang', hbScript: 'Hang', features: HANGUL, hbAutoDisable: false },

  // -------------------------------------------------------- Variable font
  { id: 'vf-default-hello', category: 'variable', font: NOTO_VF, text: 'Hello', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'vf-wght700-hello', category: 'variable', font: NOTO_VF, text: 'Hello', script: 'latn', hbScript: 'Latn', features: BASE, variations: { wght: 700 } },
  { id: 'vf-wght700-kern', category: 'variable', font: NOTO_VF, text: 'AVATAR', script: 'latn', hbScript: 'Latn', features: BASE, variations: { wght: 700 } },
  { id: 'vf-wght700-wdth875', category: 'variable', font: NOTO_VF, text: 'Wavy', script: 'latn', hbScript: 'Latn', features: BASE, variations: { wght: 700, wdth: 87.5 } },

  // ------------------------------------------------------------------ CFF
  { id: 'cff-wavy', category: 'cff', font: SOURCE_SANS, text: 'Wavy', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'cff-office-liga', category: 'cff', font: SOURCE_SANS, text: 'office fi ffi', script: 'latn', hbScript: 'Latn', features: BASE },
  { id: 'cff-kern', category: 'cff', font: SOURCE_SANS, text: 'AVATAR To Ya', script: 'latn', hbScript: 'Latn', features: BASE },
  // Optional typographic features (explicit GSUB single-substitution paths):
  // small caps, oldstyle figures, slashed zero, superscripts, ordinals.
  { id: 'cff-smcp', category: 'cff', font: SOURCE_SANS, text: 'Hello World', script: 'latn', hbScript: 'Latn', features: [...BASE, 'smcp'] },
  { id: 'cff-onum', category: 'cff', font: SOURCE_SANS, text: '0123456789', script: 'latn', hbScript: 'Latn', features: [...BASE, 'onum'] },
  { id: 'cff-zero', category: 'cff', font: SOURCE_SANS, text: '100', script: 'latn', hbScript: 'Latn', features: [...BASE, 'zero'] },
  { id: 'cff-sups', category: 'cff', font: SOURCE_SANS, text: 'x123', script: 'latn', hbScript: 'Latn', features: [...BASE, 'sups'] },
  { id: 'cff-ordn', category: 'cff', font: SOURCE_SANS, text: '2a 3o', script: 'latn', hbScript: 'Latn', features: [...BASE, 'ordn'] },
  // Alternate substitutions: salt (stylistic alternates, LookupType 1/2) and
  // aalt (access-all-alternates, LookupType 3 — picks the first alternate).
  { id: 'cff-salt', category: 'cff', font: SOURCE_SANS, text: 'a g y', script: 'latn', hbScript: 'Latn', features: [...BASE, 'salt'] },
  { id: 'cff-cv01', category: 'cff', font: SOURCE_SANS, text: 'aàâ', script: 'latn', hbScript: 'Latn', features: [...BASE, 'cv01'] },
  { id: 'cff-aalt', category: 'cff', font: SOURCE_SANS, text: 'aG9', script: 'latn', hbScript: 'Latn', features: [...BASE, 'aalt'] },
]

/** Build the hb-shape --features argument value for a case. */
export function buildHbFeatureList(c: HbCompatCase): string {
  const parts: string[] = [...c.features]
  if (c.hbAutoDisable !== false) {
    for (const tag of HB_DEFAULT_FEATURES) {
      if (!c.features.includes(tag)) parts.push(`-${tag}`)
    }
  }
  return parts.join(',')
}
