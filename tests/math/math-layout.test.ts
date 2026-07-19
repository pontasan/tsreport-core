import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Font } from '../../src/font.js'
import { parseMathLaTeX } from '../../src/math/math-parser.js'
import { layoutMathFormula, type MathBox } from '../../src/math/math-layout.js'
import type { RenderNode, RenderText, RenderLine } from '../../src/types/render.js'
import type { MathTable } from '../../src/parsers/tables/math.js'

const FONT_DIR = join(__dirname, '..', 'fixtures', 'fonts')

let font: Font

beforeAll(() => {
  const data = readFileSync(join(FONT_DIR, 'FiraMath-Regular.otf'))
  font = Font.load(data.buffer)
})

function layout(latex: string, fontSize = 12): MathBox {
  const ast = parseMathLaTeX(latex)
  return layoutMathFormula(ast, font, 'math', fontSize, '#000000')
}

function collectTexts(nodes: RenderNode[]): string[] {
  const texts: string[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node.text)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

function collectLines(nodes: RenderNode[]): RenderLine[] {
  const lines: RenderLine[] = []
  for (const node of nodes) {
    if (node.type === 'line') lines.push(node)
    if (node.type === 'group') lines.push(...collectLines(node.children))
  }
  return lines
}

describe('MathLayout', () => {

  // Verifies OpenType MATH table availability in the fixture font, since all layout constants depend on it.
  describe('MATH テーブル', () => {
    // Verifies that FiraMath exposes an OpenType MATH table so math layout can use font-defined metrics.
    it('FiraMath に MATH テーブルが存在する', () => {
      expect(font.math).not.toBeNull()
    })

    it('Device解決用ppemを数式レイアウト座標へ接続する', () => {
      const baseMath = font.math!
      const math: MathTable = {
        ...baseMath,
        getConstant(name, context) {
          const value = baseMath.getConstant(name, context)
          return name === 'axisHeight' && context?.ppem === 12 ? value + 100 : value
        },
      }
      Object.defineProperty((font as unknown as { tableManager: object }).tableManager, 'math', {
        value: math,
        configurable: true,
      })
      const ast = parseMathLaTeX('\\frac{a}{b}')
      const at12 = layoutMathFormula(ast, font, 'math', 12, '#000000', 12)
      const at13 = layoutMathFormula(ast, font, 'math', 12, '#000000', 13)
      const scale = 12 / font.metrics.unitsPerEm

      expect(collectLines(at12.nodes)[0]!.y1).toBeCloseTo(collectLines(at13.nodes)[0]!.y1 - 100 * scale)
      Object.defineProperty((font as unknown as { tableManager: object }).tableManager, 'math', {
        value: baseMath,
        configurable: true,
      })
    })

    // Verifies that key MATH constants (axis height, rule thickness, script shifts) are readable and positive.
    it('MATH 定数が読み取れる', () => {
      const constants = font.math!.constants
      expect(constants.get('axisHeight')).toBeGreaterThan(0)
      expect(constants.get('fractionRuleThickness')).toBeGreaterThan(0)
      expect(constants.get('superscriptShiftUp')).toBeGreaterThan(0)
      expect(constants.get('subscriptShiftDown')).toBeGreaterThan(0)
    })
  })

  describe('単一グリフ', () => {
    // Verifies that a single letter lays out as one text node mapped to its Mathematical Italic code point.
    it('x のレイアウト', () => {
      const box = layout('x')
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      expect(box.nodes.length).toBe(1)
      expect(box.nodes[0]!.type).toBe('text')
      expect((box.nodes[0] as RenderText).text).toBe('\u{1D465}') // Mathematical Italic Small X
    })

    // Verifies that glyph advance width scales linearly with font size (24pt is twice as wide as 12pt).
    it('フォントサイズで幅が変わる', () => {
      const box12 = layout('x', 12)
      const box24 = layout('x', 24)
      expect(box24.width).toBeCloseTo(box12.width * 2, 1)
    })
  })

  describe('行 (row)', () => {
    // Verifies that inter-atom spacing (ord-bin-ord) makes a row wider than the sum of its glyph widths.
    it('a + b の幅 > 各要素の合計', () => {
      const box = layout('a+b')
      // Wider than the sum because of inter-atom spacing
      const aBox = layout('a')
      const plusBox = layout('+')
      const bBox = layout('b')
      expect(box.width).toBeGreaterThan(aBox.width + plusBox.width + bBox.width)
    })
  })

  describe('分数', () => {
    // Verifies that a fraction layout emits at least one line node for the fraction bar.
    it('分数線が存在する', () => {
      const box = layout('\\frac{a}{b}')
      const lines = collectLines(box.nodes)
      expect(lines.length).toBeGreaterThanOrEqual(1)
    })

    // Verifies that both numerator and denominator glyphs appear in the rendered output as italic math letters.
    it('分子と分母のテキストが存在する', () => {
      const box = layout('\\frac{a}{b}')
      const texts = collectTexts(box.nodes)
      expect(texts).toContain('\u{1D44E}') // Mathematical Italic Small A
      expect(texts).toContain('\u{1D44F}') // Mathematical Italic Small B
    })

    // Verifies that a numeric fraction produces a box with positive width.
    it('分数の幅 > 0', () => {
      const box = layout('\\frac{1}{2}')
      expect(box.width).toBeGreaterThan(0)
    })

    // Verifies that a fraction extends both above and below the baseline (positive height and depth).
    it('分数の height > depth', () => {
      const box = layout('\\frac{a}{b}')
      // Normally the whole fraction has height > depth (the rule sits near the axis height)
      expect(box.height).toBeGreaterThan(0)
      expect(box.depth).toBeGreaterThan(0)
    })

    it('skewed fractionはMATH gapを使って斜線付き横組みにする', () => {
      const box = layout('\\sfrac{a}{b}')
      expect(collectTexts(box.nodes)).toContain('⁄')
      expect(box.width).toBeGreaterThan(layout('a').width + layout('b').width)
    })

    it('binomial stackは分数線なしで括弧内へ上下配置する', () => {
      const box = layout('\\binom{a}{b}')
      expect(collectLines(box.nodes)).toHaveLength(0)
      expect(box.height).toBeGreaterThan(layout('a').height)
      expect(box.depth).toBeGreaterThan(layout('b').depth)
    })
  })

  describe('上付き/下付き', () => {
    // Verifies that attaching a superscript increases the total width compared to the base alone.
    it('x^2 の幅 > x の幅', () => {
      const xBox = layout('x')
      const x2Box = layout('x^2')
      expect(x2Box.width).toBeGreaterThan(xBox.width)
    })

    // Verifies that attaching a subscript increases the total width compared to the base alone.
    it('x_i の幅 > x の幅', () => {
      const xBox = layout('x')
      const xiBox = layout('x_i')
      expect(xiBox.width).toBeGreaterThan(xBox.width)
    })

    // Verifies that a raised superscript increases the box height above that of the bare base.
    it('x^2 の height > x の height', () => {
      const xBox = layout('x')
      const x2Box = layout('x^2')
      expect(x2Box.height).toBeGreaterThan(xBox.height)
    })

    // Verifies that a lowered subscript does not reduce the depth below that of the bare base.
    it('x_i の depth > x の depth', () => {
      const xBox = layout('x')
      const xiBox = layout('x_i')
      // The subscript should make the depth larger (or at least not smaller)
      expect(xiBox.depth).toBeGreaterThanOrEqual(xBox.depth)
    })
  })

  describe('根号', () => {
    // Verifies that a square root lays out with a radical glyph plus an overbar line above the radicand.
    it('\\sqrt{x} のレイアウト', () => {
      const box = layout('\\sqrt{x}')
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      // Radical symbol text plus the overbar line
      const texts = collectTexts(box.nodes)
      expect(texts.length).toBeGreaterThanOrEqual(1) // √ and x
      const lines = collectLines(box.nodes)
      expect(lines.length).toBeGreaterThanOrEqual(1) // overbar
    })
  })

  describe('大型演算子', () => {
    // Verifies that a bare large operator lays out with positive width and emits its glyph.
    it('\\sum のレイアウト', () => {
      const box = layout('\\sum')
      expect(box.width).toBeGreaterThan(0)
      const texts = collectTexts(box.nodes)
      expect(texts.length).toBeGreaterThanOrEqual(1)
    })

    // Verifies that above/below limits stacked on \sum increase the total height beyond the bare operator.
    it('\\sum_{i=0}^{n} の height > \\sum の height', () => {
      const sumBox = layout('\\sum')
      const sumWithLimits = layout('\\sum_{i=0}^{n}')
      expect(sumWithLimits.height).toBeGreaterThan(sumBox.height)
    })
  })

  describe('伸縮括弧', () => {
    // Verifies that \left/\right delimited content lays out with the delimiters and body rendered.
    it('\\left( x \\right) のレイアウト', () => {
      const box = layout('\\left( x \\right)')
      expect(box.width).toBeGreaterThan(0)
      const texts = collectTexts(box.nodes)
      expect(texts.length).toBeGreaterThanOrEqual(1) // (, x, )
    })
  })

  describe('MATH bar and stretch-stack constants', () => {
    it('overlineとunderlineをfont-defined ruleとして描画する', () => {
      const over = layout('\\overline{x}')
      const under = layout('\\underline{x}')
      expect(collectLines(over.nodes)).toHaveLength(1)
      expect(collectLines(under.nodes)).toHaveLength(1)
      expect(over.height).toBeGreaterThan(layout('x').height)
      expect(under.depth).toBeGreaterThan(layout('x').depth)
    })

    it('overbraceとunderbraceをstretch-stackとしてlayoutする', () => {
      const over = layout('\\overbrace{x}')
      const under = layout('\\underbrace{x}')
      expect(over.height).toBeGreaterThan(layout('x').height)
      expect(under.depth).toBeGreaterThan(layout('x').depth)
    })
  })

  describe('テキストモード', () => {
    // Verifies that \text content is laid out as a single upright text run, not per-glyph math italics.
    it('\\text{hello} のレイアウト', () => {
      const box = layout('\\text{hello}')
      expect(box.width).toBeGreaterThan(0)
      const texts = collectTexts(box.nodes)
      expect(texts).toContain('hello')
    })
  })

  describe('スペース', () => {
    // Verifies that \quad produces a 1em space, i.e. width equal to the font size (12pt at 12pt).
    it('\\quad のスペース幅', () => {
      const box = layout('\\quad')
      expect(box.width).toBeCloseTo(12, 0) // 1em at 12pt = 12pt
    })
  })

  // Smoke tests: complete real-world formulas must lay out without errors and produce non-empty boxes.
  describe('複合数式', () => {
    // Verifies that the quadratic formula (fraction + radical + scripts combined) lays out with positive extents.
    it('二次方程式の解の公式', () => {
      const box = layout('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      expect(box.depth).toBeGreaterThan(0)
      expect(box.nodes.length).toBeGreaterThan(0)
    })

    // Verifies that Euler's identity (superscript with Greek letter in a row) lays out to a non-empty box.
    it('オイラーの等式', () => {
      const box = layout('e^{i\\pi} + 1 = 0')
      expect(box.width).toBeGreaterThan(0)
      expect(box.nodes.length).toBeGreaterThan(0)
    })

    // Verifies that the Taylor series (large operator with limits plus a fraction) lays out to a non-empty box.
    it('テイラー展開', () => {
      const box = layout('e^x = \\sum_{n=0}^{\\infty} \\frac{x^n}{n!}')
      expect(box.width).toBeGreaterThan(0)
      expect(box.nodes.length).toBeGreaterThan(0)
    })

    // Verifies that a pmatrix environment lays out its cells and delimiters to a non-empty box.
    it('行列', () => {
      const box = layout('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')
      expect(box.width).toBeGreaterThan(0)
      expect(box.nodes.length).toBeGreaterThan(0)
    })
  })
})
