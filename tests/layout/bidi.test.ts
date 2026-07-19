import { describe, it, expect } from 'vitest'
import { resolveBidi, getBaseDirection, getMirrorChar } from '../../src/layout/bidi.js'

// ─── Arabic-Indic digits (U+0660-U+0669) ───

describe('resolveBidi: Arabic-Indic digits', () => {
  // Verifies that Arabic-Indic digits are classified as AN and resolve to level 2 in an LTR paragraph (I1).
  it('Arabic-Indic digits (U+0660-U+0669) は BT_AN として分類される', () => {
    // ٠١٢٣٤٥٦٧٨٩ (Arabic-Indic digits)
    const text = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'
    const result = resolveBidi(text, { direction: 'ltr' })
    // AN (Arabic Number) at an even level becomes level+2 (rule I1)
    for (let i = 0; i < result.levels.length; i++) {
      expect(result.levels[i]).toBe(2)
    }
  })

  // Verifies levels of Arabic-Indic digits embedded between Latin runs in an LTR paragraph.
  it('Arabic-Indic digits は LTR 段落で level 2 を持つ', () => {
    // "abc" + Arabic-Indic digits + "def"
    const text = 'abc\u0660\u0661\u0662def'
    const result = resolveBidi(text, { direction: 'ltr' })
    expect(result.paragraphLevel).toBe(0)
    // abc → level 0 (L)
    expect(result.levels[0]).toBe(0)
    expect(result.levels[1]).toBe(0)
    expect(result.levels[2]).toBe(0)
    // Arabic-Indic digits → level 2 (AN in even level → level+2)
    expect(result.levels[3]).toBe(2)
    expect(result.levels[4]).toBe(2)
    expect(result.levels[5]).toBe(2)
    // def → level 0 (L)
    expect(result.levels[6]).toBe(0)
    expect(result.levels[7]).toBe(0)
    expect(result.levels[8]).toBe(0)
  })

  // Verifies that in an RTL paragraph AN digits get level 2 via rule I2 while Arabic letters stay at level 1.
  it('Arabic-Indic digits は RTL 段落で level 1 のまま (AN は奇数レベルで level+1 → 2)', () => {
    // Arabic letter + Arabic-Indic digits + Arabic letter
    const text = '\u0627\u0660\u0661\u0662\u0627'
    const result = resolveBidi(text, { direction: 'rtl' })
    expect(result.paragraphLevel).toBe(1)
    // Arabic letters → level 1 (R after W3)
    expect(result.levels[0]).toBe(1)
    // AN in odd level → level+1 = 2 (rule I2)
    expect(result.levels[1]).toBe(2)
    expect(result.levels[2]).toBe(2)
    expect(result.levels[3]).toBe(2)
    expect(result.levels[4]).toBe(1)
  })
})

// ─── Extended Arabic-Indic digits (U+06F0-U+06F9) ───

describe('resolveBidi: Extended Arabic-Indic digits', () => {
  // Verifies that Extended Arabic-Indic digits are classified as EN and become L (level 0) via W7 in an LTR paragraph.
  it('Extended Arabic-Indic digits (U+06F0-U+06F9) は BT_EN として分類される', () => {
    // ۰۱۲۳۴۵۶۷۸۹ (Extended Arabic-Indic digits)
    const text = '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'
    const result = resolveBidi(text, { direction: 'ltr' })
    // EN is changed to L by W7 when sosType=L → level 0
    for (let i = 0; i < result.levels.length; i++) {
      expect(result.levels[i]).toBe(0)
    }
  })

  // Verifies rule W2: EN digits following an AL letter are converted to AN.
  it('Extended Arabic-Indic digits は AL の後で AN に変換される (W2)', () => {
    // Arabic letter + Extended Arabic-Indic digits
    const text = '\u0627\u06F0\u06F1\u06F2'
    const result = resolveBidi(text)
    // Auto detection: the first strong character is AL, so the paragraph is RTL
    expect(result.paragraphLevel).toBe(1)
    // W2: EN preceded by AL → AN
    // W3: AL → R
    // I2: AN in odd level → level+1 = 2
    expect(result.levels[1]).toBe(2)
    expect(result.levels[2]).toBe(2)
    expect(result.levels[3]).toBe(2)
  })

  // Verifies that Extended Arabic-Indic digits resolve to the same levels as European digits in an LTR paragraph.
  it('Extended Arabic-Indic digits を European digits と同じ EN 扱いにする', () => {
    // In an LTR paragraph European digits and Extended Arabic-Indic digits get the same level
    const europeanResult = resolveBidi('abc123def', { direction: 'ltr' })
    const extendedResult = resolveBidi('abc\u06F1\u06F2\u06F3def', { direction: 'ltr' })
    // Both are converted to L by W7 → level 0
    for (let i = 3; i <= 5; i++) {
      expect(europeanResult.levels[i]).toBe(extendedResult.levels[i])
    }
  })
})

// ─── FSI (First Strong Isolate U+2068) ───

describe('resolveBidi: FSI (First Strong Isolate)', () => {
  // Verifies that FSI with LTR content behaves the same as LRI.
  it('FSI + LTR コンテンツ → LRI として動作', () => {
    // FSI + "Hello" + PDI
    const fsiText = '\u2068Hello\u2069'
    const lriText = '\u2066Hello\u2069'
    const fsiResult = resolveBidi(fsiText, { direction: 'ltr' })
    const lriResult = resolveBidi(lriText, { direction: 'ltr' })
    // FSI sees "Hello" (L) and acts as LRI
    // The levels of the "Hello" part should match
    for (let i = 1; i <= 5; i++) {
      expect(fsiResult.levels[i]).toBe(lriResult.levels[i])
    }
  })

  // Verifies that FSI with RTL content behaves the same as RLI.
  it('FSI + RTL コンテンツ → RLI として動作', () => {
    // FSI + Hebrew text + PDI
    const fsiText = '\u2068\u05D0\u05D1\u05D2\u2069'
    const rliText = '\u2067\u05D0\u05D1\u05D2\u2069'
    const fsiResult = resolveBidi(fsiText, { direction: 'ltr' })
    const rliResult = resolveBidi(rliText, { direction: 'ltr' })
    // FSI sees Hebrew (R) and acts as RLI
    // The levels of the Hebrew part should match
    for (let i = 1; i <= 3; i++) {
      expect(fsiResult.levels[i]).toBe(rliResult.levels[i])
    }
  })

  // Verifies that FSI skips characters inside nested isolates when searching for the first strong character.
  it('FSI は nested isolate 内の文字を無視して最初の強い文字を探す', () => {
    // FSI + RLI + "Hello" + PDI + Hebrew + PDI
    // "Hello" inside the nested isolate is ignored; the outer Hebrew is the first strong character
    const text = '\u2068\u2067Hello\u2069\u05D0\u2069'
    const result = resolveBidi(text, { direction: 'ltr' })
    // It finds Hebrew (R), so it acts as RLI
    // The Hebrew character should have an odd level
    const hebrewIndex = 6 // FSI, RLI, H, e, l, l, o are indices 0-6; see actual layout below
    // Actual code points: FSI(0), RLI(1), H(2), e(3), l(4), l(5), o(6), PDI(7), Hebrew(8), PDI(9)
    expect(result.levels[8]! & 1).toBe(1) // odd level = RTL
  })

  // Verifies that FSI with no strong character defaults to LRI (LTR).
  it('FSI + 強い文字なし → LRI として動作 (デフォルト LTR)', () => {
    // FSI + spaces + PDI
    const text = '\u2068   \u2069'
    const result = resolveBidi(text, { direction: 'ltr' })
    // No strong character, so it acts as LRI
    expect(result.paragraphLevel).toBe(0)
  })
})

// ─── W2/W7 sos type initialization ───

describe('resolveBidi: W2/W7 sos type initialization', () => {
  // Verifies that EN at the start of an RTL paragraph stays EN (W7 does not apply with sosType=R) and resolves to level 2.
  it('RTL 段落の先頭にある EN は EN のまま (W7 で R に変更されない)', () => {
    // RTL paragraph with EN at the beginning
    // sos = R (RTL paragraph), so W7's lastStrongType is R
    // W7: EN preceded by L → L (not applied here because sosType=R)
    const text = '123\u05D0' // European digits + Hebrew
    const result = resolveBidi(text, { direction: 'rtl' })
    expect(result.paragraphLevel).toBe(1)
    // EN becomes level 2 in an RTL paragraph (I2: EN in odd level → level+1)
    // In W7 sosType=R, so EN is not converted to L → stays EN
    // I2: EN at odd level → level + 1 = 2
    expect(result.levels[0]).toBe(2)
    expect(result.levels[1]).toBe(2)
    expect(result.levels[2]).toBe(2)
  })

  // Verifies that EN at the start of an LTR paragraph is converted to L by W7.
  it('LTR 段落の先頭にある EN は W7 で L に変更される', () => {
    // LTR paragraph with EN at the beginning
    // sos = L (LTR paragraph), so W7's lastStrongType is L
    // W7: EN preceded by L → L
    const text = '123abc'
    const result = resolveBidi(text, { direction: 'ltr' })
    expect(result.paragraphLevel).toBe(0)
    // W7 converts EN → L → level 0
    expect(result.levels[0]).toBe(0)
    expect(result.levels[1]).toBe(0)
    expect(result.levels[2]).toBe(0)
  })

  // Verifies that EN at the start of an RTL paragraph is not converted to AN because sosType is R, not AL.
  it('W2: RTL 段落の先頭にある EN は sosType=R (AL ではない) なので AN にならない', () => {
    // sos = R, so W2's lastStrongType is R
    // W2: EN preceded by AL → AN (sos is R, not AL → no conversion)
    const text = '123' // just digits
    const result = resolveBidi(text, { direction: 'rtl' })
    expect(result.paragraphLevel).toBe(1)
    // EN does not follow AL, so it is not converted to AN
    // W7: sosType=R, so EN is not converted to L → stays EN
    // I2: EN at odd level → level+1 = 2
    expect(result.levels[0]).toBe(2)
    expect(result.levels[1]).toBe(2)
    expect(result.levels[2]).toBe(2)
  })

  // Verifies rule W2: EN following an AL letter is converted to AN.
  it('W2: AL の後の EN は AN に変換される', () => {
    const text = '\u0627123' // Arabic letter Alef + digits
    const result = resolveBidi(text, { direction: 'rtl' })
    // W2: EN preceded by AL → AN
    // AN at odd level → level+1 = 2 (I2)
    expect(result.levels[1]).toBe(2)
    expect(result.levels[2]).toBe(2)
    expect(result.levels[3]).toBe(2)
  })

  // Verifies rule W7: EN following an L letter is converted to L.
  it('W7: L の後の EN は L に変換される', () => {
    const text = 'abc123'
    const result = resolveBidi(text, { direction: 'ltr' })
    // W7: EN preceded by L → L
    // level 0 (L at even level)
    expect(result.levels[3]).toBe(0)
    expect(result.levels[4]).toBe(0)
    expect(result.levels[5]).toBe(0)
  })

  // Verifies rule W7: EN following an R letter is not converted to L and resolves to level 2 (I1).
  it('W7: R の後の EN は L にならない', () => {
    const text = '\u05D0123abc' // Hebrew + digits + Latin
    const result = resolveBidi(text, { direction: 'ltr' })
    // W7: lastStrongType is R (Hebrew), so EN does not become L
    // EN at even level → level+2 = 2 (I1)
    expect(result.levels[1]).toBe(2)
    expect(result.levels[2]).toBe(2)
    expect(result.levels[3]).toBe(2)
  })
})

// ─── getBaseDirection with surrogate pairs ───

describe('getBaseDirection: surrogate pairs', () => {
  // Verifies that a BMP LTR character yields ltr.
  it('BMP の LTR 文字', () => {
    expect(getBaseDirection('Hello')).toBe('ltr')
  })

  // Verifies that BMP Hebrew characters yield rtl.
  it('BMP の RTL 文字 (Hebrew)', () => {
    expect(getBaseDirection('\u05D0\u05D1\u05D2')).toBe('rtl')
  })

  // Verifies that BMP Arabic characters yield rtl.
  it('BMP の RTL 文字 (Arabic)', () => {
    expect(getBaseDirection('\u0627\u0628\u0629')).toBe('rtl')
  })

  // Verifies that an empty string defaults to ltr.
  it('空文字列はデフォルト ltr', () => {
    expect(getBaseDirection('')).toBe('ltr')
  })

  // Verifies that digits alone (no strong directional character) default to ltr.
  it('数字のみはデフォルト ltr (強い方向文字がない)', () => {
    expect(getBaseDirection('12345')).toBe('ltr')
  })

  // Verifies that a non-BMP RTL character (surrogate pair) is detected as rtl.
  it('非 BMP の RTL 文字 (U+10800 Cypriot Syllabary)', () => {
    // U+10800 is a surrogate pair: D802 DC00
    const text = String.fromCodePoint(0x10800)
    expect(text.length).toBe(2) // surrogate pair, so length=2
    expect(getBaseDirection(text)).toBe('rtl')
  })

  // Verifies another non-BMP RTL script (Mende Kikakui) is detected as rtl.
  it('非 BMP の RTL 文字 (U+1E800 Mende Kikakui)', () => {
    const text = String.fromCodePoint(0x1E800)
    expect(text.length).toBe(2)
    expect(getBaseDirection(text)).toBe('rtl')
  })

  // Verifies that leading spaces before a surrogate-pair RTL character do not break detection.
  it('非 BMP 文字の前にスペースがある場合もサロゲートペアを正しく処理', () => {
    // spaces + surrogate pair RTL character
    const text = '   ' + String.fromCodePoint(0x10800)
    expect(getBaseDirection(text)).toBe('rtl')
  })

  // Verifies that leading digits before a surrogate-pair RTL character do not break detection.
  it('非 BMP 文字の前に数字がある場合', () => {
    // digits + surrogate pair RTL character
    const text = '123' + String.fromCodePoint(0x10800)
    expect(getBaseDirection(text)).toBe('rtl')
  })

  // Verifies that the first strong character wins: a non-BMP LTR character before RTL yields ltr.
  it('非 BMP の LTR 文字の後に RTL 文字がある場合は LTR', () => {
    // CJK Supplementary (U+20000) is BT_L by default fallback
    const text = String.fromCodePoint(0x20000) + '\u05D0'
    expect(getBaseDirection(text)).toBe('ltr')
  })

  // Verifies that a lone high surrogate does not crash direction detection.
  it('不正なサロゲート (high surrogate のみ) でもクラッシュしない', () => {
    // isolated high surrogate
    const text = '\uD800Hello'
    // Confirm it does not crash - the result is implementation-defined
    expect(() => getBaseDirection(text)).not.toThrow()
  })

  // Verifies that a lone low surrogate does not crash direction detection.
  it('不正なサロゲート (low surrogate のみ) でもクラッシュしない', () => {
    const text = '\uDC00Hello'
    expect(() => getBaseDirection(text)).not.toThrow()
  })
})

// ─── resolveBidi basic tests ───

describe('resolveBidi: 基本動作', () => {
  // Verifies that an empty string yields empty visual order and levels with paragraph level 0.
  it('空文字列', () => {
    const result = resolveBidi('')
    expect(result.visualOrder).toEqual([])
    expect(result.levels.length).toBe(0)
    expect(result.paragraphLevel).toBe(0)
  })

  // Verifies that pure LTR text keeps logical order and level 0 everywhere.
  it('LTR テキスト', () => {
    const result = resolveBidi('Hello', { direction: 'ltr' })
    expect(result.paragraphLevel).toBe(0)
    expect(result.visualOrder).toEqual([0, 1, 2, 3, 4])
    for (let i = 0; i < result.levels.length; i++) {
      expect(result.levels[i]).toBe(0)
    }
  })

  // Verifies that pure RTL text is reversed in visual order.
  it('RTL テキスト (Hebrew)', () => {
    // שלום (Shalom)
    const text = '\u05E9\u05DC\u05D5\u05DD'
    const result = resolveBidi(text, { direction: 'rtl' })
    expect(result.paragraphLevel).toBe(1)
    // RTL, so the visual order is reversed
    expect(result.visualOrder).toEqual([3, 2, 1, 0])
  })

  // Verifies that mixed LTR+RTL text resolves to level 0 for Latin and level 1 for Hebrew.
  it('混在テキスト: LTR + RTL', () => {
    // "Hello" + Hebrew
    const text = 'Hello\u05E9\u05DC\u05D5\u05DD'
    const result = resolveBidi(text, { direction: 'ltr' })
    expect(result.paragraphLevel).toBe(0)
    // "Hello" is level 0, Hebrew is level 1
    for (let i = 0; i < 5; i++) {
      expect(result.levels[i]).toBe(0)
    }
    for (let i = 5; i < 9; i++) {
      expect(result.levels[i]).toBe(1)
    }
  })

  // Verifies auto direction detection picks LTR when the first strong character is LTR.
  it('auto direction で最初の強い文字が LTR', () => {
    const result = resolveBidi('Hello World')
    expect(result.paragraphLevel).toBe(0)
  })

  // Verifies auto direction detection picks RTL when the first strong character is RTL.
  it('auto direction で最初の強い文字が RTL', () => {
    const result = resolveBidi('\u05E9\u05DC\u05D5\u05DD Hello')
    expect(result.paragraphLevel).toBe(1)
  })
})

// ─── getMirrorChar ───

describe('getMirrorChar', () => {
  // Verifies mirroring of parentheses.
  it('括弧のミラーリング', () => {
    expect(getMirrorChar(0x0028)).toBe(0x0029) // ( → )
    expect(getMirrorChar(0x0029)).toBe(0x0028) // ) → (
  })

  // Verifies mirroring of square brackets.
  it('角括弧のミラーリング', () => {
    expect(getMirrorChar(0x005B)).toBe(0x005D) // [ → ]
    expect(getMirrorChar(0x005D)).toBe(0x005B) // ] → [
  })

  // Verifies mirroring of curly braces.
  it('波括弧のミラーリング', () => {
    expect(getMirrorChar(0x007B)).toBe(0x007D) // { → }
    expect(getMirrorChar(0x007D)).toBe(0x007B) // } → {
  })

  // Verifies mirroring of angle brackets.
  it('山括弧のミラーリング', () => {
    expect(getMirrorChar(0x003C)).toBe(0x003E) // < → >
    expect(getMirrorChar(0x003E)).toBe(0x003C) // > → <
  })

  // Verifies mirroring of guillemets.
  it('ギュメのミラーリング', () => {
    expect(getMirrorChar(0x00AB)).toBe(0x00BB) // « → »
    expect(getMirrorChar(0x00BB)).toBe(0x00AB) // » → «
  })

  // Verifies that non-mirrored characters are returned unchanged.
  it('ミラーリング対象でない文字はそのまま返す', () => {
    expect(getMirrorChar(0x0041)).toBe(0x0041) // A → A
    expect(getMirrorChar(0x0030)).toBe(0x0030) // 0 → 0
  })
})

// ─── Explicit directional formatting characters ───

describe('resolveBidi: 明示的方向制御文字', () => {
  // Verifies that LRO raises the embedding level of enclosed RTL characters.
  it('LRO は埋め込みレベルを上げる', () => {
    // LRO + Hebrew + PDF
    const text = '\u202D\u05D0\u05D1\u05D2\u202C'
    const result = resolveBidi(text, { direction: 'ltr' })
    // LRO sets the next even level (2)
    // Hebrew is treated as R and I1 gives level+1 = 3
    expect(result.levels[1]).toBeGreaterThan(0)
    expect(result.levels[2]).toBeGreaterThan(0)
    expect(result.levels[3]).toBeGreaterThan(0)
  })

  // Verifies that RLO overrides Latin characters to RTL (odd levels).
  it('RLO は RTL オーバーライド', () => {
    // RLO + Latin + PDF → Latin is treated as RTL
    const text = '\u202EHello\u202C'
    const result = resolveBidi(text, { direction: 'ltr' })
    // Characters inside RLO have an odd level (RTL)
    for (let i = 1; i <= 5; i++) {
      expect(result.levels[i]! & 1).toBe(1)
    }
  })

  // Verifies that an LRI/PDI isolate keeps its content at even (LTR) levels inside an RTL paragraph.
  it('LRI / PDI isolate ペア', () => {
    // LRI + text + PDI
    const text = '\u2066Hello\u2069'
    const result = resolveBidi(text, { direction: 'rtl' })
    // Text inside LRI has even levels
    for (let i = 1; i <= 5; i++) {
      expect(result.levels[i]! & 1).toBe(0)
    }
  })

  // Verifies that an RLI/PDI isolate keeps its content at odd (RTL) levels inside an LTR paragraph.
  it('RLI / PDI isolate ペア', () => {
    // RLI + Hebrew + PDI
    const text = '\u2067\u05D0\u05D1\u2069'
    const result = resolveBidi(text, { direction: 'ltr' })
    // Text inside RLI has odd levels
    expect(result.levels[1]! & 1).toBe(1)
    expect(result.levels[2]! & 1).toBe(1)
  })
})
