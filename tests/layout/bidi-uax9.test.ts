import { describe, it, expect } from 'vitest'
import { resolveBidi, getBaseDirection, getMirrorChar } from '../../src/layout/bidi.js'

// Comprehensive UAX #9 coverage: N0 bracket pairs (BD16), isolating run
// sequences (X10), nested isolates, weak type resolution across isolates,
// number handling (AN/EN/ES/ET/CS), full-range classification and mirroring.
// The implementation is additionally validated against the full official
// BidiTest.txt / BidiCharacterTest.txt conformance suites (Unicode 17.0).

// ─── N0: bracket pair resolution ───

describe('resolveBidi: N0 括弧ペア (BD16)', () => {
  // N0 b: a strong type matching the embedding direction inside the pair
  // sets both brackets to the embedding direction.
  it('N0 b: RTL 段落で括弧内に R がある場合、両括弧は R になる', () => {
    // א(ב)ג in an RTL paragraph
    const result = resolveBidi('א(ב)ג', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([1, 1, 1, 1, 1])
    expect(result.visualOrder).toEqual([4, 3, 2, 1, 0])
  })

  // N0 b takes priority over the opposite direction even if the opposite
  // strong type appears first inside the pair.
  it('N0 b: 埋め込み方向の強い文字は反対方向より優先される', () => {
    // a(bא)c in an RTL paragraph: inside has L (opposite) and R (embedding)
    const result = resolveBidi('a(bא)c', { direction: 'rtl' })
    // Brackets take R (level 1); Latin letters take level 2
    expect(Array.from(result.levels)).toEqual([2, 1, 2, 1, 1, 2])
  })

  // N0 c1: only opposite-direction strong types inside, and the preceding
  // context is also the opposite direction -> brackets take that direction.
  it('N0 c1: 括弧内が反対方向のみ、直前文脈も反対方向 → 括弧は反対方向', () => {
    // א (ב) a in an LTR paragraph: inside R, context before opening is R
    const result = resolveBidi('א (ב) a', { direction: 'ltr' })
    // Hebrew, brackets and the space between them are all level 1
    expect(Array.from(result.levels)).toEqual([1, 1, 1, 1, 1, 0, 0])
  })

  // N0 c2: only opposite-direction strong types inside, but the preceding
  // context matches the embedding direction -> brackets take the embedding direction.
  it('N0 c2: 括弧内が反対方向のみ、直前文脈は埋め込み方向 → 括弧は埋め込み方向', () => {
    // a (ב) c in an LTR paragraph: inside R, context before opening is L
    const result = resolveBidi('a (ב) c', { direction: 'ltr' })
    expect(Array.from(result.levels)).toEqual([0, 0, 0, 1, 0, 0, 0])
  })

  // N0 d: no strong type inside the pair -> brackets stay neutral and are
  // resolved by N1/N2.
  it('N0 d: 括弧内に強い文字がない場合は N1/N2 で解決される', () => {
    // a(!)ב in an LTR paragraph: neutral run between L and R -> N2 -> L
    const result = resolveBidi('a(!)ב', { direction: 'ltr' })
    expect(Array.from(result.levels)).toEqual([0, 0, 0, 0, 1])
    // Same text in an RTL paragraph: neutral run between R..R (sos/eos) -> R
    const rtl = resolveBidi('א(!)ב', { direction: 'rtl' })
    expect(Array.from(rtl.levels)).toEqual([1, 1, 1, 1, 1])
  })

  // N0 treats EN and AN as R when scanning for strong types.
  it('N0: 括弧内の EN は R として扱われる', () => {
    // א(1)ב in an LTR paragraph: EN inside counts as R (opposite of e=L),
    // context before the opening bracket is R -> brackets take R
    const result = resolveBidi('א(1)ב', { direction: 'ltr' })
    expect(Array.from(result.levels)).toEqual([1, 1, 2, 1, 1])
    expect(result.visualOrder).toEqual([4, 3, 2, 1, 0])
  })

  // NSM clause of N0: characters that were NSM before W1 and immediately
  // follow a bracket changed by N0 take the bracket's resolved type.
  it('N0: 括弧の直後の NSM は括弧の解決タイプに追従する', () => {
    // א(ב)◌̀ a in an LTR paragraph: ")" resolves to R, the following
    // combining mark must also become R (level 1), not neutral (level 0)
    const result = resolveBidi('א(ב)̀ a', { direction: 'ltr' })
    expect(Array.from(result.levels)).toEqual([1, 1, 1, 1, 1, 0, 0])
  })

  // BD16 uses canonical equivalence: U+2329/U+232A pair with U+3008/U+3009.
  it('BD16: U+2329 と U+3009 は正準等価によりペアになる', () => {
    // א〈a〉ב with U+2329 open and U+3009 close in an RTL paragraph:
    // inside is L only (opposite), context is R (embedding) -> brackets take e=R
    const result = resolveBidi('א〈a〉ב', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([1, 1, 2, 1, 1])
  })

  // Mismatched bracket types do not pair (BD16).
  it('BD16: 対応しない括弧はペアにならない', () => {
    // a(ב]c in an LTR paragraph: "(" and "]" stay neutral -> N2 -> L
    const result = resolveBidi('a(ב]c', { direction: 'ltr' })
    expect(Array.from(result.levels)).toEqual([0, 0, 1, 0, 0])
  })

  // Nested bracket pairs are each resolved (sorted by opening position).
  it('N0: ネストした括弧ペアはそれぞれ解決される', () => {
    // א[(ב)]ג in an RTL paragraph: both pairs contain R -> all brackets R
    const result = resolveBidi('א[(ב)]ג', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([1, 1, 1, 1, 1, 1, 1])
  })

  // BD16 stack depth is 63: pairing succeeds at 63 nested brackets.
  it('BD16: 63 レベルのネストまで括弧ペアが成立する', () => {
    // a + 63 opens + bא + 63 closes + c in an RTL paragraph:
    // innermost pair contains R (embedding) -> all brackets resolve to R (level 1)
    const text = 'a' + '('.repeat(63) + 'bא' + ')'.repeat(63) + 'c'
    const result = resolveBidi(text, { direction: 'rtl' })
    expect(result.levels[1]).toBe(1)   // first opening bracket
    expect(result.levels[63]).toBe(1)  // innermost opening bracket
    expect(result.levels[66]).toBe(1)  // innermost closing bracket
  })

  // BD16: pushing the 64th opening bracket stops pair identification.
  it('BD16: 64 レベルのネストでは括弧ペア処理が停止する', () => {
    // Same shape with 64 nested brackets: no pairs are formed, so the
    // opening brackets are neutrals between L..L -> N1 -> L (level 2)
    const text = 'a' + '('.repeat(64) + 'bא' + ')'.repeat(64) + 'c'
    const result = resolveBidi(text, { direction: 'rtl' })
    expect(result.levels[1]).toBe(2)   // neutral resolved to L, not R
    expect(result.levels[64]).toBe(2)
  })

  // Brackets under a directional override are no longer ON and never pair.
  it('N0: RLO 配下の括弧はオーバーライドされペア対象外', () => {
    // RLO a ( b ) PDF in an LTR paragraph: everything inside is forced to R
    const result = resolveBidi('‮a(b)‬', { direction: 'ltr' })
    expect(result.levels[1]! & 1).toBe(1)
    expect(result.levels[2]! & 1).toBe(1)
    expect(result.levels[3]! & 1).toBe(1)
    expect(result.levels[4]! & 1).toBe(1)
  })
})

// ─── X10: isolating run sequences ───

describe('resolveBidi: X10 isolating run sequences', () => {
  // The outer AL context does not leak into the isolate: W2 inside the
  // isolate starts from the isolate's own sos, not from the Arabic letter.
  it('isolate 内の W2: 外側の AL 文脈は isolate 内に届かない', () => {
    // Arabic + LRI "1" PDI in an RTL paragraph: the isolated EN has sos=L
    // (isolate level 2), so it stays EN/L at level 2. If the AL context
    // leaked inside, it would become AN and resolve to level 4.
    const result = resolveBidi('ا⁦1⁩', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([1, 1, 2, 1])
  })

  // Isolate content is excluded from the outer sequence (the AL context
  // crosses the isolate), while embedding content splits it - observable
  // via W2 (EN -> AN) followed by W5/W7 on the trailing "$".
  it('isolate は外側の弱い型解決を分断しない (embedding は分断する)', () => {
    // Isolate version: AL context crosses the isolate -> "1" becomes AN ->
    // "$" is not adjacent to EN, stays neutral -> R (level 1)
    const iso = resolveBidi('ا⁦a⁩1$', { direction: 'rtl' })
    expect(iso.levels[4]).toBe(2) // AN at odd level -> +1
    expect(iso.levels[5]).toBe(1)
    // Embedding version: the trailing sequence gets sos=L from the LRE
    // level -> "1" stays EN, W5 turns "$" into EN, W7 turns both into L
    const emb = resolveBidi('ا‪a‬1$', { direction: 'rtl' })
    expect(emb.levels[4]).toBe(2)
    expect(emb.levels[5]).toBe(2)
  })

  // W1: an NSM directly following a PDI resolves to ON, not to the
  // preceding character's type.
  it('W1: PDI 直後の NSM は ON になる', () => {
    // א LRI PDI ◌̀ b in an LTR paragraph: the NSM becomes ON and is then
    // resolved by N2 to L (level 0); copying the strong R would give level 1
    const result = resolveBidi('א⁦⁩̀b', { direction: 'ltr' })
    expect(Array.from(result.levels)).toEqual([1, 0, 0, 0, 0])
  })

  // Nested isolates raise levels independently per nesting depth.
  it('ネストした isolates のレベル', () => {
    // a RLI b LRI c PDI d PDI e in an LTR paragraph
    const result = resolveBidi('a⁧b⁦c⁩d⁩e', { direction: 'ltr' })
    expect(Array.from(result.levels)).toEqual([0, 0, 2, 2, 2, 2, 2, 0, 0])
  })

  // An unmatched PDI is a neutral (NI) and does not change levels.
  it('対応しない PDI は中立文字として扱われる', () => {
    const result = resolveBidi('a⁩b', { direction: 'ltr' })
    expect(Array.from(result.levels)).toEqual([0, 0, 0])
  })

  // An isolate initiator without a matching PDI isolates to the end of text.
  it('対応する PDI がない isolate initiator はテキスト末尾まで有効', () => {
    // a LRI א: the Hebrew letter is inside the LTR isolate (level 2 -> R -> 3)
    const result = resolveBidi('a⁦א', { direction: 'ltr' })
    expect(Array.from(result.levels)).toEqual([0, 0, 3])
  })

  // Isolate initiators and PDIs are NIs for N1: between two L they become L.
  it('isolate initiator / PDI は N1 で中立として解決される', () => {
    // a RLI א PDI b in an LTR paragraph: RLI/PDI sit between L..L -> level 0
    const result = resolveBidi('a⁧א⁩b', { direction: 'ltr' })
    expect(Array.from(result.levels)).toEqual([0, 0, 1, 0, 0])
  })

  // P2 skips isolate content when detecting the paragraph direction.
  it('P2: 段落方向の自動判定は isolate 内容をスキップする', () => {
    // RLI a PDI א: the first strong character outside isolates is Hebrew -> RTL
    const result = resolveBidi('⁧a⁩א')
    expect(result.paragraphLevel).toBe(1)
  })
})

// ─── X1-X8: explicit embedding levels ───

describe('resolveBidi: 明示的埋め込みレベル (X1-X8)', () => {
  // Nested RLE reach the maximum depth 125; deeper embeddings overflow.
  it('RLE ネストは最大深度 125 まで有効', () => {
    // 63 RLE reach level 125 (1, 3, ..., 125)
    const result = resolveBidi('‫'.repeat(63) + 'א', { direction: 'ltr' })
    expect(result.levels[63]).toBe(125)
    // The 64th RLE overflows: the level stays at 125
    const overflow = resolveBidi('‫'.repeat(64) + 'א', { direction: 'ltr' })
    expect(overflow.levels[64]).toBe(125)
  })

  // LRE raises to even levels; level 126 would exceed the max depth.
  it('LRE ネストは level 124 まで有効', () => {
    const result = resolveBidi('‪'.repeat(62) + 'a', { direction: 'ltr' })
    expect(result.levels[62]).toBe(124)
    const overflow = resolveBidi('‪'.repeat(63) + 'a', { direction: 'ltr' })
    expect(overflow.levels[63]).toBe(124)
  })

  // A PDF cannot pop an isolate entry from the directional status stack.
  it('PDF は isolate をポップできない (X7)', () => {
    // RLI PDF א PDI: the PDF is ignored; Hebrew stays at isolate level 1
    const result = resolveBidi('⁧‬א⁩', { direction: 'ltr' })
    expect(result.levels[2]).toBe(1)
  })

  // A PDF after an overflowed embedding consumes the overflow, not the stack.
  it('PDF はオーバーフローした埋め込みを先に消費する (X7)', () => {
    // 62 LRE (level 124) + 1 LRE (overflow) + PDF + a: the PDF cancels the
    // overflowed LRE, so "a" remains at level 124
    const result = resolveBidi('‪'.repeat(63) + '‬a', { direction: 'ltr' })
    expect(result.levels[64]).toBe(124)
  })

  // Overrides inside isolates work independently of the outer context.
  it('isolate 内のオーバーライド (LRI + RLO)', () => {
    // a LRI RLO b PDF PDI c: "b" is overridden to R inside the LTR isolate
    const result = resolveBidi('a⁦‮b‬⁩c', { direction: 'ltr' })
    expect(result.levels[3]).toBe(3)
    expect(result.levels[0]).toBe(0)
    expect(result.levels[6]).toBe(0)
  })

  // RLO forces European digits to RTL levels.
  it('RLO は数字も強制的に R にする', () => {
    const result = resolveBidi('‮123‬', { direction: 'ltr' })
    expect(result.levels[1]! & 1).toBe(1)
    expect(result.levels[2]! & 1).toBe(1)
    expect(result.levels[3]! & 1).toBe(1)
  })
})

// ─── W rules: number handling (EN/AN/ES/ET/CS) ───

describe('resolveBidi: 数値処理 (W1-W7)', () => {
  // W4: a single ES between two EN becomes EN.
  it('W4: EN ES EN → すべて EN', () => {
    // "1+2" in an RTL paragraph: EN at odd level -> level 2
    const result = resolveBidi('1+2', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([2, 2, 2])
  })

  // A separated ES is not joined (W4 requires direct adjacency).
  it('W4: 空白で分離された ES は ON になる', () => {
    // "1 + 2" in an RTL paragraph: "+" and the spaces resolve as neutrals -> R
    const result = resolveBidi('1 + 2', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([2, 1, 1, 1, 2])
  })

  // W4: a single CS between two EN becomes EN.
  it('W4: EN CS EN → すべて EN', () => {
    const result = resolveBidi('1.2', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([2, 2, 2])
  })

  // W4: a single CS between two AN becomes AN (Arabic comma between
  // Arabic-Indic digits).
  it('W4: AN CS AN → すべて AN', () => {
    // ٠،١ (Arabic-Indic digit, Arabic comma U+060C, digit)
    const result = resolveBidi('٠،١', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([2, 2, 2])
  })

  // W2 + W4: EN after AL becomes AN; CS joins the resulting AN pair.
  it('W2+W4: AL の後の EN,EN は AN になり CS で結合される', () => {
    // Arabic letter + "1,2"
    const result = resolveBidi('ا' + '1,2', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([1, 2, 2, 2])
  })

  // W5: ET sequences adjacent to EN become EN (both sides).
  it('W5: EN に隣接する ET の並びは EN になる', () => {
    // "$$$123" and "123%%%" in an RTL paragraph
    const before = resolveBidi('$$$123', { direction: 'rtl' })
    expect(Array.from(before.levels)).toEqual([2, 2, 2, 2, 2, 2])
    const after = resolveBidi('123%%%', { direction: 'rtl' })
    expect(Array.from(after.levels)).toEqual([2, 2, 2, 2, 2, 2])
  })

  // W5/W6: ET without adjacent EN becomes ON.
  it('W6: EN に隣接しない ET は ON になる', () => {
    // א$ב: "$" resolves as a neutral between R..R -> R
    const result = resolveBidi('א$ב', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([1, 1, 1])
  })

  // ET does not join AN (W5 applies to EN only).
  it('W5: AN に隣接する ET は EN にならない', () => {
    // Arabic-Indic digit + "%": the ET stays neutral -> R (level 1)
    const result = resolveBidi('٠%', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([2, 1])
  })

  // U+2212 MINUS SIGN is ES; U+00B1 PLUS-MINUS SIGN is ET.
  it('U+2212 は ES、U+00B1 は ET として分類される', () => {
    const minus = resolveBidi('1−2', { direction: 'rtl' })
    expect(Array.from(minus.levels)).toEqual([2, 2, 2])
    const plusMinus = resolveBidi('±1', { direction: 'rtl' })
    expect(Array.from(plusMinus.levels)).toEqual([2, 2])
  })

  // Currency symbols from the Currency Symbols block are ET.
  it('通貨記号 (U+20A0-U+20CF) は ET として分類される', () => {
    // ₿123 (bitcoin sign)
    const result = resolveBidi('₿123', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([2, 2, 2, 2])
  })
})

// ─── Full-range BiDi classification ───

describe('resolveBidi: 全範囲の BiDi 分類', () => {
  // RTL scripts across the BMP and supplementary planes.
  it('RTL スクリプトの分類 (R/AL)', () => {
    const rtlSamples = [
      0x05D0,  // Hebrew
      0x0627,  // Arabic (AL)
      0x0710,  // Syriac (AL)
      0x0780,  // Thaana (AL)
      0x07C0,  // NKo (R)
      0x0800,  // Samaritan (R)
      0x0840,  // Mandaic (R)
      0x08A0,  // Arabic Extended-A (AL)
      0xFB1D,  // Hebrew Presentation Forms (R)
      0xFB50,  // Arabic Presentation Forms-A (AL)
      0x10800, // Cypriot Syllabary (R, supplementary plane)
      0x1E900, // Adlam (R, supplementary plane)
    ]
    for (const cp of rtlSamples) {
      expect(getBaseDirection(String.fromCodePoint(cp))).toBe('rtl')
    }
  })

  // AN outside the Arabic block: Rumi digits and Arabic separators.
  it('AN の分類: Rumi digits (U+10E60) と U+066B', () => {
    // AN at even level resolves to level 2 (I1)
    const rumi = resolveBidi('a' + String.fromCodePoint(0x10E60), { direction: 'ltr' })
    expect(rumi.levels[1]).toBe(2)
    const sep = resolveBidi('٠٫١', { direction: 'rtl' })
    expect(Array.from(sep.levels)).toEqual([2, 2, 2])
  })

  // EN outside ASCII: superscripts and enclosed numbers.
  it('EN の分類: U+2070 (superscript) と U+2488 (digit full stop)', () => {
    const sup = resolveBidi('א⁰', { direction: 'rtl' })
    expect(sup.levels[1]).toBe(2)
    const enc = resolveBidi('א⒈', { direction: 'rtl' })
    expect(enc.levels[1]).toBe(2)
  })

  // NSM classification: Hebrew point and Arabic superscript alef.
  it('NSM の分類: U+05BF, U+0670 は先行文字の型を継承する (W1)', () => {
    const heb = resolveBidi('אֿ', { direction: 'rtl' })
    expect(Array.from(heb.levels)).toEqual([1, 1])
    const ara = resolveBidi('اٰ', { direction: 'rtl' })
    expect(Array.from(ara.levels)).toEqual([1, 1])
  })

  // LTR scripts stay LTR, including supplementary-plane CJK.
  it('LTR スクリプトの分類 (CJK 拡張含む)', () => {
    expect(getBaseDirection('あ')).toBe('ltr')          // Hiragana
    expect(getBaseDirection('一')).toBe('ltr')          // CJK
    expect(getBaseDirection('가')).toBe('ltr')          // Hangul
    expect(getBaseDirection(String.fromCodePoint(0x20000))).toBe('ltr') // CJK Ext B
  })
})

// ─── L1: level reset ───

describe('resolveBidi: L1 レベルリセット', () => {
  // Trailing whitespace resets to the paragraph level.
  it('行末の空白は段落レベルに戻る', () => {
    // Hebrew + trailing space in an LTR paragraph
    const ltr = resolveBidi('א ', { direction: 'ltr' })
    expect(Array.from(ltr.levels)).toEqual([1, 0])
    // Latin + trailing space in an RTL paragraph
    const rtl = resolveBidi('ab ', { direction: 'rtl' })
    expect(Array.from(rtl.levels)).toEqual([2, 2, 1])
  })

  // Segment separators (tab) reset to the paragraph level mid-text.
  it('セグメント区切り (タブ) は段落レベルに戻る', () => {
    const result = resolveBidi('ab\tcd', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([2, 2, 1, 2, 2])
  })

  // Whitespace before a segment separator also resets.
  it('セグメント区切りの直前の空白も段落レベルに戻る', () => {
    const result = resolveBidi('ab \tcd', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([2, 2, 1, 1, 2, 2])
  })

  // Trailing isolate formatting characters reset together with whitespace.
  it('行末の isolate 制御文字も空白と同様にリセットされる', () => {
    // a א LRI PDI space in an RTL paragraph
    const result = resolveBidi('aא⁦⁩ ', { direction: 'rtl' })
    expect(result.levels[2]).toBe(1)
    expect(result.levels[3]).toBe(1)
    expect(result.levels[4]).toBe(1)
  })
})

// ─── Mirroring (full BidiMirroring.txt) ───

describe('getMirrorChar: BidiMirroring.txt 全対応', () => {
  // Entries far beyond the basic bracket set.
  it('数学記号・特殊括弧のミラーリング', () => {
    expect(getMirrorChar(0x2A2B)).toBe(0x2A2C) // minus sign with falling dots
    expect(getMirrorChar(0x2A2C)).toBe(0x2A2B)
    expect(getMirrorChar(0x22A6)).toBe(0x2ADE) // assertion
    expect(getMirrorChar(0x2ADE)).toBe(0x22A6)
    expect(getMirrorChar(0x0F3A)).toBe(0x0F3B) // Tibetan gug rtags gyon
    expect(getMirrorChar(0x169B)).toBe(0x169C) // Ogham feather mark
    expect(getMirrorChar(0x301A)).toBe(0x301B) // white square brackets
    expect(getMirrorChar(0x2E24)).toBe(0x2E25) // bottom half brackets
    expect(getMirrorChar(0xFE59)).toBe(0xFE5A) // small parentheses
  })

  // Standard bracket pairs still mirror.
  it('基本括弧のミラーリング', () => {
    expect(getMirrorChar(0x0028)).toBe(0x0029)
    expect(getMirrorChar(0x005B)).toBe(0x005D)
    expect(getMirrorChar(0x007B)).toBe(0x007D)
    expect(getMirrorChar(0x00AB)).toBe(0x00BB)
    expect(getMirrorChar(0x2264)).toBe(0x2265)
    expect(getMirrorChar(0x300C)).toBe(0x300D) // corner bracket
    expect(getMirrorChar(0x3010)).toBe(0x3011) // black lenticular bracket
  })

  // Characters without a mirrored counterpart are returned unchanged.
  it('ミラー対象外の文字はそのまま返す', () => {
    expect(getMirrorChar(0x0041)).toBe(0x0041) // A
    expect(getMirrorChar(0x221E)).toBe(0x221E) // infinity (Bidi_Mirrored but no pair)
    expect(getMirrorChar(0x05D0)).toBe(0x05D0) // Hebrew alef
  })
})

// ─── Integration: mixed content reordering ───

describe('resolveBidi: 混在コンテンツの並べ替え', () => {
  // Classic mixed sentence: RTL words around an LTR word.
  it('RTL 段落内の LTR 単語', () => {
    // א ab ב in an RTL paragraph
    const result = resolveBidi('א ab ב', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([1, 1, 2, 2, 1, 1])
    // Visual: ב, space, ab (LTR inside), space, א
    expect(result.visualOrder).toEqual([5, 4, 2, 3, 1, 0])
  })

  // Numbers inside RTL text keep logical digit order (level 2 runs).
  it('RTL テキスト内の数字は数字内で LTR 順を保つ', () => {
    // א123ב
    const result = resolveBidi('א123ב', { direction: 'rtl' })
    expect(Array.from(result.levels)).toEqual([1, 2, 2, 2, 1])
    expect(result.visualOrder).toEqual([4, 1, 2, 3, 0])
  })

  // Bracketed RTL inside an LTR sentence keeps the pair visually consistent.
  it('LTR 文中の括弧付き RTL テキスト', () => {
    // see (אב) now
    const result = resolveBidi('see (אב) now', { direction: 'ltr' })
    // Brackets stay L (N0 c2: context is L), Hebrew is level 1
    expect(result.levels[4]).toBe(0)
    expect(result.levels[5]).toBe(1)
    expect(result.levels[6]).toBe(1)
    expect(result.levels[7]).toBe(0)
    // Hebrew letters swap places visually; everything else stays
    expect(result.visualOrder).toEqual([0, 1, 2, 3, 4, 6, 5, 7, 8, 9, 10, 11])
  })
})
