import { describe, it, expect } from 'vitest'
import { parseMathLaTeX } from '../../src/math/math-parser.js'
import type { MathNode, MathGlyph, MathRow, MathFraction, MathScript, MathRadical, MathOperator, MathDelimited, MathAccent, MathMatrix, MathSpace, MathText } from '../../src/math/math-ast.js'

// ─── Helpers ───

function asGlyph(node: MathNode): MathGlyph {
  expect(node.type).toBe('glyph')
  return node as MathGlyph
}
function asRow(node: MathNode): MathRow {
  expect(node.type).toBe('row')
  return node as MathRow
}
function asFrac(node: MathNode): MathFraction {
  expect(node.type).toBe('frac')
  return node as MathFraction
}
function asScript(node: MathNode): MathScript {
  expect(node.type).toBe('script')
  return node as MathScript
}
function asRadical(node: MathNode): MathRadical {
  expect(node.type).toBe('radical')
  return node as MathRadical
}
function asOperator(node: MathNode): MathOperator {
  expect(node.type).toBe('operator')
  return node as MathOperator
}
function asDelimited(node: MathNode): MathDelimited {
  expect(node.type).toBe('delimited')
  return node as MathDelimited
}
function asAccent(node: MathNode): MathAccent {
  expect(node.type).toBe('accent')
  return node as MathAccent
}
function asMatrix(node: MathNode): MathMatrix {
  expect(node.type).toBe('matrix')
  return node as MathMatrix
}
function asSpace(node: MathNode): MathSpace {
  expect(node.type).toBe('space')
  return node as MathSpace
}
function asText(node: MathNode): MathText {
  expect(node.type).toBe('text')
  return node as MathText
}

// ─── Tests ───

describe('MathParser', () => {

  describe('単一文字', () => {
    // Verifies that a lowercase letter parses to a glyph node with atom type 'ord'.
    it('英小文字', () => {
      const node = parseMathLaTeX('x')
      const g = asGlyph(node)
      expect(g.codePoint).toBe(0x78) // 'x'
      expect(g.atomType).toBe('ord')
    })

    // Verifies that a digit parses to a glyph node with atom type 'ord'.
    it('数字', () => {
      const node = parseMathLaTeX('2')
      const g = asGlyph(node)
      expect(g.codePoint).toBe(0x32) // '2'
      expect(g.atomType).toBe('ord')
    })

    // Verifies that '+' is classified as a binary-operator atom ('bin') for TeX spacing rules.
    it('演算子 +', () => {
      const node = parseMathLaTeX('+')
      const g = asGlyph(node)
      expect(g.codePoint).toBe(0x2B)
      expect(g.atomType).toBe('bin')
    })

    // Verifies that '=' is classified as a relation atom ('rel') for TeX spacing rules.
    it('関係 =', () => {
      const node = parseMathLaTeX('=')
      const g = asGlyph(node)
      expect(g.codePoint).toBe(0x3D)
      expect(g.atomType).toBe('rel')
    })
  })

  describe('行 (row)', () => {
    // Verifies that a multi-glyph expression parses into a row of three glyph children in order.
    it('a + b', () => {
      const node = parseMathLaTeX('a+b')
      const row = asRow(node)
      expect(row.children.length).toBe(3)
      expect(asGlyph(row.children[0]!).codePoint).toBe(0x61) // a
      expect(asGlyph(row.children[1]!).codePoint).toBe(0x2B) // +
      expect(asGlyph(row.children[2]!).codePoint).toBe(0x62) // b
    })

    // Verifies that whitespace in the source is skipped and atom types (ord/rel/ord) are assigned correctly.
    it('x = 1', () => {
      const node = parseMathLaTeX('x = 1')
      const row = asRow(node)
      expect(row.children.length).toBe(3)
      expect(asGlyph(row.children[0]!).atomType).toBe('ord')
      expect(asGlyph(row.children[1]!).atomType).toBe('rel')
      expect(asGlyph(row.children[2]!).atomType).toBe('ord')
    })
  })

  describe('上付き/下付き', () => {
    // Verifies that '^' produces a script node with sup set and sub null.
    it('x^2', () => {
      const node = parseMathLaTeX('x^2')
      const s = asScript(node)
      expect(asGlyph(s.base).codePoint).toBe(0x78)
      expect(s.sup).not.toBeNull()
      expect(asGlyph(s.sup!).codePoint).toBe(0x32)
      expect(s.sub).toBeNull()
    })

    // Verifies that '_' produces a script node with sub set and sup null.
    it('x_i', () => {
      const node = parseMathLaTeX('x_i')
      const s = asScript(node)
      expect(asGlyph(s.base).codePoint).toBe(0x78)
      expect(s.sup).toBeNull()
      expect(s.sub).not.toBeNull()
      expect(asGlyph(s.sub!).codePoint).toBe(0x69) // i
    })

    // Verifies that superscript and subscript on the same base merge into a single script node.
    it('a^{b}_{c}', () => {
      const node = parseMathLaTeX('a^{b}_{c}')
      const s = asScript(node)
      expect(asGlyph(s.base).codePoint).toBe(0x61)
      expect(asGlyph(s.sup!).codePoint).toBe(0x62)
      expect(asGlyph(s.sub!).codePoint).toBe(0x63)
    })

    // Verifies that a braced multi-token superscript parses as a row of its four elements.
    it('x^{2n+1}', () => {
      const node = parseMathLaTeX('x^{2n+1}')
      const s = asScript(node)
      expect(asGlyph(s.base).codePoint).toBe(0x78)
      const sup = asRow(s.sup!)
      expect(sup.children.length).toBe(4) // 2, n, +, 1
    })
  })

  describe('分数', () => {
    // Verifies that \frac parses with the first argument as numerator and second as denominator.
    it('\\frac{a}{b}', () => {
      const node = parseMathLaTeX('\\frac{a}{b}')
      const f = asFrac(node)
      expect(asGlyph(f.numerator).codePoint).toBe(0x61)
      expect(asGlyph(f.denominator).codePoint).toBe(0x62)
    })

    // Verifies that numeric fraction arguments parse to the correct digit glyphs.
    it('\\frac{1}{2}', () => {
      const node = parseMathLaTeX('\\frac{1}{2}')
      const f = asFrac(node)
      expect(asGlyph(f.numerator).codePoint).toBe(0x31) // 1
      expect(asGlyph(f.denominator).codePoint).toBe(0x32) // 2
    })

    // Verifies that a fraction nested inside a numerator parses recursively with correct structure.
    it('入れ子分数 \\frac{\\frac{a}{b}}{c}', () => {
      const node = parseMathLaTeX('\\frac{\\frac{a}{b}}{c}')
      const f = asFrac(node)
      const inner = asFrac(f.numerator)
      expect(asGlyph(inner.numerator).codePoint).toBe(0x61)
      expect(asGlyph(inner.denominator).codePoint).toBe(0x62)
      expect(asGlyph(f.denominator).codePoint).toBe(0x63)
    })

    it('skewed fraction・stack・binomialのlayout kindを保持する', () => {
      expect((parseMathLaTeX('\\sfrac{a}{b}') as MathFraction).kind).toBe('skewed')
      expect((parseMathLaTeX('\\stackrel{a}{b}') as MathFraction).kind).toBe('stack')
      const binom = parseMathLaTeX('\\binom{a}{b}') as MathDelimited
      expect((binom.body as MathFraction).kind).toBe('stack')
      expect([binom.open, binom.close]).toEqual([0x28, 0x29])
    })
  })

  describe('根号', () => {
    // Verifies that \sqrt parses to a radical node with the radicand set and no degree.
    it('\\sqrt{x}', () => {
      const node = parseMathLaTeX('\\sqrt{x}')
      const r = asRadical(node)
      expect(asGlyph(r.radicand).codePoint).toBe(0x78)
      expect(r.degree).toBeNull()
    })

    // Verifies that the optional bracket argument of \sqrt is parsed as the radical degree.
    it('\\sqrt[3]{x}', () => {
      const node = parseMathLaTeX('\\sqrt[3]{x}')
      const r = asRadical(node)
      expect(asGlyph(r.radicand).codePoint).toBe(0x78)
      expect(r.degree).not.toBeNull()
      expect(asGlyph(r.degree!).codePoint).toBe(0x33) // 3
    })
  })

  describe('大型演算子', () => {
    // Verifies that \sum parses as a large operator with limits placement enabled by default.
    it('\\sum', () => {
      const node = parseMathLaTeX('\\sum')
      const op = asOperator(node)
      expect(op.codePoint).toBe(0x2211) // ∑
      expect(op.largeop).toBe(true)
      expect(op.limits).toBe(true)
    })

    // Verifies that \int parses as a large operator with limits disabled (integrals default to nolimits).
    it('\\int', () => {
      const node = parseMathLaTeX('\\int')
      const op = asOperator(node)
      expect(op.codePoint).toBe(0x222B) // ∫
      expect(op.largeop).toBe(true)
      expect(op.limits).toBe(false) // \int defaults to nolimits
    })

    // Verifies that sub/superscripts on \sum are attached as below/above limits on the operator node.
    it('\\sum_{i=0}^{n}', () => {
      const node = parseMathLaTeX('\\sum_{i=0}^{n}')
      const op = asOperator(node)
      expect(op.codePoint).toBe(0x2211)
      expect(op.below).not.toBeNull()
      expect(op.above).not.toBeNull()
    })

    // Verifies that \prod parses as a limits-style large operator with the product code point.
    it('\\prod', () => {
      const op = asOperator(parseMathLaTeX('\\prod'))
      expect(op.codePoint).toBe(0x220F)
      expect(op.limits).toBe(true)
    })
  })

  describe('伸縮括弧', () => {
    // Verifies that \left(...\right) parses to a delimited node with parenthesis code points.
    it('\\left( ... \\right)', () => {
      const node = parseMathLaTeX('\\left( x \\right)')
      const d = asDelimited(node)
      expect(d.open).toBe(0x0028) // (
      expect(d.close).toBe(0x0029) // )
    })

    // Verifies that square brackets are accepted as \left/\right delimiters.
    it('\\left[ ... \\right]', () => {
      const node = parseMathLaTeX('\\left[ x \\right]')
      const d = asDelimited(node)
      expect(d.open).toBe(0x005B)
      expect(d.close).toBe(0x005D)
    })

    // Verifies that escaped braces \{ \} are accepted as \left/\right delimiters.
    it('\\left\\{ ... \\right\\}', () => {
      const node = parseMathLaTeX('\\left\\{ x \\right\\}')
      const d = asDelimited(node)
      expect(d.open).toBe(0x007B)
      expect(d.close).toBe(0x007D)
    })

    // Verifies that the '.' null delimiter yields code point 0 (invisible) on the open side.
    it('\\left. ... \\right) (片側のみ)', () => {
      const node = parseMathLaTeX('\\left. x \\right)')
      const d = asDelimited(node)
      expect(d.open).toBe(0) // invisible
      expect(d.close).toBe(0x0029)
    })
  })

  describe('アクセント', () => {
    // Verifies that \hat parses to an over-positioned accent node with the combining circumflex.
    it('\\hat{x}', () => {
      const node = parseMathLaTeX('\\hat{x}')
      const a = asAccent(node)
      expect(asGlyph(a.base).codePoint).toBe(0x78)
      expect(a.accentCodePoint).toBe(0x0302)
      expect(a.position).toBe('over')
    })

    // Verifies that \tilde maps to the combining tilde accent (U+0303).
    it('\\tilde{x}', () => {
      const a = asAccent(parseMathLaTeX('\\tilde{x}'))
      expect(a.accentCodePoint).toBe(0x0303)
    })

    // Verifies that \vec maps to the combining right arrow above (U+20D7).
    it('\\vec{v}', () => {
      const a = asAccent(parseMathLaTeX('\\vec{v}'))
      expect(a.accentCodePoint).toBe(0x20D7)
    })

    // Verifies that \dot maps to the combining dot above (U+0307).
    it('\\dot{x}', () => {
      const a = asAccent(parseMathLaTeX('\\dot{x}'))
      expect(a.accentCodePoint).toBe(0x0307)
    })

    // Verifies that \ddot maps to the combining diaeresis (U+0308).
    it('\\ddot{x}', () => {
      const a = asAccent(parseMathLaTeX('\\ddot{x}'))
      expect(a.accentCodePoint).toBe(0x0308)
    })

    // Verifies that \bar maps to the combining macron (U+0304).
    it('\\bar{x}', () => {
      const a = asAccent(parseMathLaTeX('\\bar{x}'))
      expect(a.accentCodePoint).toBe(0x0304)
    })
  })

  describe('ギリシャ文字', () => {
    // Verifies that \alpha maps to the Greek small alpha code point.
    it('\\alpha', () => {
      const g = asGlyph(parseMathLaTeX('\\alpha'))
      expect(g.codePoint).toBe(0x03B1)
    })

    // Verifies that \beta maps to the Greek small beta code point.
    it('\\beta', () => {
      const g = asGlyph(parseMathLaTeX('\\beta'))
      expect(g.codePoint).toBe(0x03B2)
    })

    // Verifies that capitalized Greek commands map to uppercase letters (\Omega → U+03A9).
    it('\\Omega (大文字)', () => {
      const g = asGlyph(parseMathLaTeX('\\Omega'))
      expect(g.codePoint).toBe(0x03A9)
    })

    // Verifies that \pi maps to the Greek small pi code point.
    it('\\pi', () => {
      const g = asGlyph(parseMathLaTeX('\\pi'))
      expect(g.codePoint).toBe(0x03C0)
    })
  })

  describe('関係演算子', () => {
    // Verifies that \leq maps to U+2264 and is classified as a relation atom.
    it('\\leq', () => {
      const g = asGlyph(parseMathLaTeX('\\leq'))
      expect(g.codePoint).toBe(0x2264)
      expect(g.atomType).toBe('rel')
    })

    // Verifies that \neq maps to the not-equal sign (U+2260).
    it('\\neq', () => {
      const g = asGlyph(parseMathLaTeX('\\neq'))
      expect(g.codePoint).toBe(0x2260)
    })

    // Verifies that \in maps to the element-of sign (U+2208).
    it('\\in', () => {
      const g = asGlyph(parseMathLaTeX('\\in'))
      expect(g.codePoint).toBe(0x2208)
    })

    // Verifies that \approx maps to the almost-equal sign (U+2248).
    it('\\approx', () => {
      const g = asGlyph(parseMathLaTeX('\\approx'))
      expect(g.codePoint).toBe(0x2248)
    })
  })

  describe('二項演算子', () => {
    // Verifies that \times maps to U+00D7 and is classified as a binary-operator atom.
    it('\\times', () => {
      const g = asGlyph(parseMathLaTeX('\\times'))
      expect(g.codePoint).toBe(0x00D7)
      expect(g.atomType).toBe('bin')
    })

    // Verifies that \cdot maps to the dot operator (U+22C5).
    it('\\cdot', () => {
      const g = asGlyph(parseMathLaTeX('\\cdot'))
      expect(g.codePoint).toBe(0x22C5)
    })

    // Verifies that \pm maps to the plus-minus sign (U+00B1).
    it('\\pm', () => {
      const g = asGlyph(parseMathLaTeX('\\pm'))
      expect(g.codePoint).toBe(0x00B1)
    })
  })

  describe('その他の記号', () => {
    // Verifies that \infty maps to the infinity sign (U+221E).
    it('\\infty', () => {
      const g = asGlyph(parseMathLaTeX('\\infty'))
      expect(g.codePoint).toBe(0x221E)
    })

    // Verifies that \partial maps to the partial differential sign (U+2202).
    it('\\partial', () => {
      const g = asGlyph(parseMathLaTeX('\\partial'))
      expect(g.codePoint).toBe(0x2202)
    })

    // Verifies that \forall maps to the for-all sign (U+2200).
    it('\\forall', () => {
      const g = asGlyph(parseMathLaTeX('\\forall'))
      expect(g.codePoint).toBe(0x2200)
    })

    // Verifies that \rightarrow maps to U+2192 and is classified as a relation atom.
    it('\\rightarrow', () => {
      const g = asGlyph(parseMathLaTeX('\\rightarrow'))
      expect(g.codePoint).toBe(0x2192)
      expect(g.atomType).toBe('rel')
    })
  })

  describe('スペース', () => {
    // Verifies that \, produces a space node of 3/18 em (TeX thin space).
    it('\\, (thin space)', () => {
      const s = asSpace(parseMathLaTeX('\\,'))
      expect(s.width).toBeCloseTo(3 / 18)
    })

    // Verifies that \quad produces a space node of exactly 1 em.
    it('\\quad', () => {
      const s = asSpace(parseMathLaTeX('\\quad'))
      expect(s.width).toBe(1)
    })
  })

  describe('テキストモード', () => {
    // Verifies that \text content becomes a single text node with its literal content.
    it('\\text{hello}', () => {
      const t = asText(parseMathLaTeX('\\text{hello}'))
      expect(t.content).toBe('hello')
    })

    // Verifies that \text preserves trailing spaces inside braces when mixed with math tokens.
    it('\\text{if } x > 0', () => {
      const node = parseMathLaTeX('\\text{if } x > 0')
      const row = asRow(node)
      expect(asText(row.children[0]!).content).toBe('if ')
    })
  })

  describe('行列', () => {
    // Verifies that a pmatrix environment parses into a 2x2 cell grid with pmatrix delimiters.
    it('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', () => {
      const node = parseMathLaTeX('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')
      const m = asMatrix(node)
      expect(m.delimiters).toBe('pmatrix')
      expect(m.cells.length).toBe(2) // 2 rows
      expect(m.cells[0]!.length).toBe(2) // 2 cols
    })

    // Verifies that the bmatrix environment is recognized with its bracket delimiter kind.
    it('\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}', () => {
      const m = asMatrix(parseMathLaTeX('\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}'))
      expect(m.delimiters).toBe('bmatrix')
      expect(m.cells.length).toBe(2)
    })

    // Verifies that the cases environment parses as a matrix with the 'cases' delimiter kind.
    it('\\begin{cases} x & \\text{if } x > 0 \\\\ -x & \\text{otherwise} \\end{cases}', () => {
      const m = asMatrix(parseMathLaTeX('\\begin{cases} x & \\text{if } x > 0 \\\\ -x & \\text{otherwise} \\end{cases}'))
      expect(m.delimiters).toBe('cases')
      expect(m.cells.length).toBe(2)
    })
  })

  // End-to-end parses of realistic formulas to check node composition across features.
  describe('複合数式', () => {
    // Verifies that the quadratic formula parses to a 3-child row: x, =, and a fraction node.
    it('二次方程式の解の公式', () => {
      const node = parseMathLaTeX('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')
      const row = asRow(node)
      // x = frac{...}{...}
      expect(row.children.length).toBe(3)
      expect(asGlyph(row.children[0]!).codePoint).toBe(0x78) // x
      expect(asGlyph(row.children[1]!).codePoint).toBe(0x3D) // =
      expect(row.children[2]!.type).toBe('frac')
    })

    // Verifies that Euler's identity parses to a 5-child row starting with a script node.
    it('オイラーの等式', () => {
      const node = parseMathLaTeX('e^{i\\pi} + 1 = 0')
      const row = asRow(node)
      expect(row.children.length).toBe(5) // e^{iπ}, +, 1, =, 0
      expect(row.children[0]!.type).toBe('script')
    })

    // Verifies that the Taylor series parses to script, =, operator-with-limits, and fraction nodes in order.
    it('テイラー展開', () => {
      const node = parseMathLaTeX('e^x = \\sum_{n=0}^{\\infty} \\frac{x^n}{n!}')
      const row = asRow(node)
      // e^x, =, sum_{n=0}^{infty}, frac{x^n}{n!}
      expect(row.children.length).toBe(4)
      expect(row.children[0]!.type).toBe('script') // e^x
      expect(asGlyph(row.children[1]!).codePoint).toBe(0x3D) // =
      expect(row.children[2]!.type).toBe('operator') // sum
      expect(row.children[3]!.type).toBe('frac')
    })

    // Verifies that an integral with bounds parses to a row whose first child is an operator node.
    it('積分', () => {
      const node = parseMathLaTeX('\\int_{0}^{\\infty} e^{-x^2} dx')
      const row = asRow(node)
      expect(row.children[0]!.type).toBe('operator') // int
    })

    // Verifies that a fraction inside \left/\right parses as the delimited node's direct body.
    it('\\left( と分数の組み合わせ', () => {
      const node = parseMathLaTeX('\\left( \\frac{a}{b} \\right)')
      const d = asDelimited(node)
      expect(d.open).toBe(0x0028)
      expect(d.close).toBe(0x0029)
      const body = d.body
      expect(body.type).toBe('frac')
    })
  })

  describe('- を minus sign に変換', () => {
    // Verifies that ASCII hyphen is converted to U+2212 MINUS SIGN with binary atom type.
    it('- は U+2212 (MINUS SIGN)', () => {
      const node = parseMathLaTeX('-')
      const g = asGlyph(node)
      expect(g.codePoint).toBe(0x2212)
      expect(g.atomType).toBe('bin')
    })
  })

  describe('\\{ \\} エスケープ括弧', () => {
    // Verifies that escaped \{ parses as a literal brace glyph with atom type 'open'.
    it('\\{ は U+007B', () => {
      const g = asGlyph(parseMathLaTeX('\\{'))
      expect(g.codePoint).toBe(0x007B)
      expect(g.atomType).toBe('open')
    })

    // Verifies that escaped \} parses as a literal brace glyph with atom type 'close'.
    it('\\} は U+007D', () => {
      const g = asGlyph(parseMathLaTeX('\\}'))
      expect(g.codePoint).toBe(0x007D)
      expect(g.atomType).toBe('close')
    })
  })

  describe('overline / underline', () => {
    // Verifies that \overline parses as an accent node positioned over its base.
    it('\\overline{AB}', () => {
      const a = asAccent(parseMathLaTeX('\\overline{AB}'))
      expect(a.position).toBe('over')
    })

    // Verifies that \underline parses as an accent node positioned under its base.
    it('\\underline{x}', () => {
      const a = asAccent(parseMathLaTeX('\\underline{x}'))
      expect(a.position).toBe('under')
    })
  })
})

describe('MathParser malformed-input termination', () => {
  // Regression: an unterminated matrix environment with an unconsumable char
  // (e.g. a stray '}') used to spin forever because the cell parse made no
  // progress. Parsing must terminate.
  it('terminates on an unterminated matrix environment', () => {
    const node = parseMathLaTeX('\\begin{pmatrix}}')
    expect(node).toBeDefined()
  })

  it('terminates on an unterminated array environment', () => {
    const node = parseMathLaTeX('\\begin{array}{c}}')
    expect(node).toBeDefined()
  })
})
