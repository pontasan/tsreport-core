import { describe, it, expect } from 'vitest'
import { parseMarkup } from '../../src/layout/markup-parser.js'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate } from '../../src/types/template.js'
import type { RenderNode, RenderText } from '../../src/types/render.js'

// ─── Helpers ───

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

// ─── Parser tests ───

describe('parseMarkup', () => {
  // Verifies that plain text yields a single unstyled run.
  it('プレーンテキスト', () => {
    const runs = parseMarkup('Hello World')
    expect(runs).toHaveLength(1)
    expect(runs[0]!.text).toBe('Hello World')
  })

  // Verifies that <b> marks only the enclosed run as bold.
  it('<b> タグ', () => {
    const runs = parseMarkup('<b>太字</b>テキスト')
    expect(runs).toHaveLength(2)
    expect(runs[0]!.text).toBe('太字')
    expect(runs[0]!.bold).toBe(true)
    expect(runs[1]!.text).toBe('テキスト')
    expect(runs[1]!.bold).toBeUndefined()
  })

  // Verifies that <i> marks only the enclosed run as italic.
  it('<i> タグ', () => {
    const runs = parseMarkup('<i>italic</i> normal')
    expect(runs).toHaveLength(2)
    expect(runs[0]!.italic).toBe(true)
    expect(runs[1]!.italic).toBeUndefined()
  })

  // Verifies that <u> marks the run as underlined.
  it('<u> タグ', () => {
    const runs = parseMarkup('<u>underline</u>')
    expect(runs).toHaveLength(1)
    expect(runs[0]!.underline).toBe(true)
  })

  // Verifies that <s> marks the run as strikethrough.
  it('<s> タグ（取り消し線）', () => {
    const runs = parseMarkup('<s>strikethrough</s>')
    expect(runs).toHaveLength(1)
    expect(runs[0]!.strikethrough).toBe(true)
  })

  // Verifies that nested <b><i> tags combine bold and italic on a single run.
  it('ネストしたマークアップ', () => {
    const runs = parseMarkup('<b><i>bold italic</i></b>')
    expect(runs).toHaveLength(1)
    expect(runs[0]!.text).toBe('bold italic')
    expect(runs[0]!.bold).toBe(true)
    expect(runs[0]!.italic).toBe(true)
  })

  // Verifies that <font> face, size, and color attributes are applied to the run.
  it('<font> タグ（face, size, color）', () => {
    const runs = parseMarkup('<font face="Arial" size="14" color="#FF0000">red text</font>')
    expect(runs).toHaveLength(1)
    expect(runs[0]!.fontFamily).toBe('Arial')
    expect(runs[0]!.fontSize).toBe(14)
    expect(runs[0]!.color).toBe('#FF0000')
  })

  // Verifies that <br> is emitted as a dedicated newline run between text runs.
  it('<br> タグ', () => {
    const runs = parseMarkup('line1<br>line2')
    expect(runs).toHaveLength(3)
    expect(runs[0]!.text).toBe('line1')
    expect(runs[1]!.text).toBe('\n')
    expect(runs[2]!.text).toBe('line2')
  })

  // Verifies that <sup> marks the run as superscript.
  it('<sup> タグ', () => {
    const runs = parseMarkup('x<sup>2</sup>')
    expect(runs).toHaveLength(2)
    expect(runs[0]!.text).toBe('x')
    expect(runs[1]!.text).toBe('2')
    expect(runs[1]!.superscript).toBe(true)
  })

  // Verifies that <sub> marks the run as subscript.
  it('<sub> タグ', () => {
    const runs = parseMarkup('H<sub>2</sub>O')
    expect(runs).toHaveLength(3)
    expect(runs[1]!.text).toBe('2')
    expect(runs[1]!.subscript).toBe(true)
  })

  // Verifies that HTML entities are decoded into their literal characters.
  it('HTML エンティティ', () => {
    const runs = parseMarkup('&lt;tag&gt; &amp; &quot;value&quot;')
    expect(runs[0]!.text).toBe('<tag> & "value"')
  })

  // Verifies that partially nested tags split into runs carrying the correct style combinations.
  it('複雑なネスト', () => {
    const runs = parseMarkup('<b>bold <i>bold-italic</i> bold-only</b>')
    expect(runs).toHaveLength(3)
    expect(runs[0]!.text).toBe('bold ')
    expect(runs[0]!.bold).toBe(true)
    expect(runs[1]!.text).toBe('bold-italic')
    expect(runs[1]!.bold).toBe(true)
    expect(runs[1]!.italic).toBe(true)
    expect(runs[2]!.text).toBe(' bold-only')
    expect(runs[2]!.bold).toBe(true)
    expect(runs[2]!.italic).toBeUndefined()
  })
})

// ─── Engine integration tests ───

describe('engine markup integration', () => {
  // Verifies that a staticText with markup=html is rendered as multiple styled RenderText nodes.
  it('markup=html の staticText が複数の RenderText を生成', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 200, height: 30,
            text: '<b>Bold</b> and <i>Italic</i>',
            markup: 'html',
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const texts = collectTexts(doc.pages[0]!.children)

    // Bold text
    const boldText = texts.find(t => t.text === 'Bold')
    expect(boldText).toBeDefined()
    expect(boldText!.bold).toBe(true)

    // Italic text
    const italicText = texts.find(t => t.text === 'Italic')
    expect(italicText).toBeDefined()
    expect(italicText!.italic).toBe(true)

    // " and " text
    const andText = texts.find(t => t.text === ' and ')
    expect(andText).toBeDefined()
  })

  // Verifies that a textField with markup=html parses field data as markup at evaluation time.
  it('markup=html の textField', () => {
    const template: ReportTemplate = {
      page: { size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      fields: [{ name: 'html', type: 'string' }],
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 200, height: 30,
            expression: 'field.html',
            markup: 'html',
          }],
        }],
      },
    }
    const doc = createReport(template, {
      rows: [{ html: '<b>Dynamic</b> content' }],
    })
    const texts = collectTexts(doc.pages[0]!.children)
    const dynamicText = texts.find(t => t.text === 'Dynamic')
    expect(dynamicText).toBeDefined()
    expect(dynamicText!.bold).toBe(true)
  })

  // Verifies that the styled-text <style> tag maps forecolor/isBold/size onto the run.
  it('<style> タグ（スタイルドテキスト）', () => {
    const runs = parseMarkup('<style forecolor="#FF0000" isBold="true" size="14">styled</style> plain')
    expect(runs[0]!.text).toBe('styled')
    expect(runs[0]!.color).toBe('#FF0000')
    expect(runs[0]!.bold).toBe(true)
    expect(runs[0]!.fontSize).toBe(14)
    expect(runs[1]!.text).toBe(' plain')
    expect(runs[1]!.color).toBeUndefined()
  })

  // Verifies that nested <style> tags merge isItalic/isUnderline/isStrikeThrough attributes.
  it('<style> タグのネストと isItalic/isUnderline/isStrikeThrough', () => {
    const runs = parseMarkup('<style isItalic="true"><style isUnderline="true" isStrikeThrough="true">x</style></style>')
    expect(runs[0]!.italic).toBe(true)
    expect(runs[0]!.underline).toBe(true)
    expect(runs[0]!.strikethrough).toBe(true)
  })

  // Verifies that a staticText with markup=styled renders style runs with color and bold applied.
  it('markup=styled の staticText がスタイルラン描画される', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'staticText',
            x: 0, y: 0, width: 280, height: 30,
            text: '通常 <style forecolor="#0000FF" isBold="true">青太字</style> <b>太字</b>',
            markup: 'styled',
          }],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}] })
    const texts = collectTexts(doc.pages[0]!.children)
    const blue = texts.find(t => t.text.includes('青太字'))
    expect(blue).toBeDefined()
    expect(blue!.color).toBe('#0000FF')
    expect(blue!.bold).toBe(true)
    const bold = texts.find(t => t.text.includes('太字') && t.color !== '#0000FF')
    expect(bold).toBeDefined()
    expect(bold!.bold).toBe(true)
  })

  // Verifies that a textField with markup=styled renders style runs from field data.
  it('markup=styled の textField がスタイルラン描画される', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      bands: {
        details: [{
          height: 30,
          elements: [{
            type: 'textField',
            x: 0, y: 0, width: 280, height: 30,
            expression: 'field.value',
            markup: 'styled',
          }],
        }],
      },
    }
    const doc = createReport(template, {
      rows: [{ value: '<style isUnderline="true">下線</style>' }],
    })
    const texts = collectTexts(doc.pages[0]!.children)
    const underlined = texts.find(t => t.text === '下線')
    expect(underlined).toBeDefined()
    expect(underlined!.underline).toBe(true)
  })
})
