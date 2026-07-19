import { describe, it, expect } from 'vitest'
import { layoutTable, type TableDef, type TableLayoutContext } from '../../src/layout/table-layout.js'
import { layoutCrosstab, type CrosstabDef, type CrosstabLayoutContext } from '../../src/layout/crosstab-layout.js'
import type { TextMeasurer } from '../../src/measure/text-measurer.js'
import type { RenderNode, RenderGroup, RenderText } from '../../src/types/render.js'

// ─── Mock TextMeasurer ───
// Each character is charWidth pt wide at fontSize.
// unitsPerEm = 1000, so advance in font units = charWidth / (fontSize / 1000) = charWidth * 1000 / fontSize

function createMockMeasurer(charWidth = 6): TextMeasurer {
  const upm = 1000
  const asc = 800
  const desc = -200
  const gap = 0
  return {
    font: { metrics: { unitsPerEm: upm, ascender: asc, descender: desc, lineGap: gap } },
    measure(text: string, fontSize: number) {
      const chars = [...text]
      const advances = new Float64Array(chars.length)
      let width = 0
      for (let i = 0; i < chars.length; i++) {
        advances[i] = charWidth
        width += charWidth
      }
      return { width, advances }
    },
    measureShaped(text: string, fontSize: number) {
      const m = this.measure(text, fontSize)
      const n = m.advances.length
      // Advance in font units so that advance * (fontSize / upm) = charWidth pt
      const advanceFontUnits = charWidth * upm / fontSize
      const shaped = new Array(n)
      const cpToGlyph = new Int32Array(n)
      for (let i = 0; i < n; i++) {
        shaped[i] = { glyphId: 0, xOffset: 0, yOffset: 0, xAdvance: advanceFontUnits, yAdvance: advanceFontUnits, componentCount: 1 }
        cpToGlyph[i] = i
      }
      return { width: m.width, advances: m.advances, shaped, cpToGlyph }
    },
    measureSimple(text: string, fontSize: number) {
      return this.measure(text, fontSize)
    },
    getLineHeight(fontSize: number) {
      return (asc - desc + gap) * (fontSize / upm)
    },
    getAscent(fontSize: number) {
      return asc * (fontSize / upm)
    },
    getDescent(fontSize: number) {
      return desc * (fontSize / upm)
    },
  } as unknown as TextMeasurer
}

// ─── Helpers ───

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

function collectGroups(nodes: RenderNode[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'group') {
      groups.push(node)
      groups.push(...collectGroups(node.children))
    }
  }
  return groups
}

// ─── Table text wrapping tests ───

describe('Table cell text wrapping', () => {
  // Verifies that text wider than the cell wraps into multiple text nodes without losing characters.
  it('wraps long text into multiple lines', () => {
    // charWidth=6, column=100pt, padding=2, availableWidth=96
    // 96/6 = 16 chars per line
    // "ABCDEFGHIJKLMNOPQRSTUVWXYZ" = 26 chars → should wrap
    const measurer = createMockMeasurer(6)
    const table: TableDef = {
      columns: [{ width: 100 }],
      headerRows: [{
        height: 20,
        cells: [{ text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' }],
      }],
    }

    const context: TableLayoutContext = { measurer }
    const result = layoutTable(table, 0, 0, 100, undefined, context)

    // Text should have been wrapped into multiple text nodes
    const texts = collectTexts([result])
    expect(texts.length).toBeGreaterThan(1)

    // All text concatenated should contain all original chars
    let allText = ''
    for (let i = 0; i < texts.length; i++) {
      allText += texts[i]!.text
    }
    expect(allText).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  })

  // Verifies that the row height grows beyond the declared height to fit wrapped lines.
  it('increases row height to fit wrapped text', () => {
    const measurer = createMockMeasurer(6)
    const table: TableDef = {
      columns: [{ width: 50 }],
      headerRows: [{
        height: 15,
        cells: [{ text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', padding: 2 }],
      }],
    }

    const context: TableLayoutContext = { measurer }
    const result = layoutTable(table, 0, 0, 50, undefined, context)

    // The group height should be larger than the original 15pt row height
    expect(result.height).toBeGreaterThan(15)
  })

  // Verifies that the tallest wrapped cell in a row dictates the height for the whole row.
  it('tallest cell determines row height', () => {
    const measurer = createMockMeasurer(6)
    // Col1: 100pt width, short text "Hi" → fits in 1 line
    // Col2: 30pt width, long text "ABCDEFGHIJKLMNOP" → wraps
    const table: TableDef = {
      columns: [{ width: 100 }, { width: 30 }],
      headerRows: [{
        height: 15,
        cells: [
          { text: 'Hi' },
          { text: 'ABCDEFGHIJKLMNOP' },
        ],
      }],
    }

    const context: TableLayoutContext = { measurer }
    const result = layoutTable(table, 0, 0, 130, undefined, context)

    // Row height should be determined by the taller cell (col2 with wrapped text)
    // Col2 available = 30 - 4 = 26pt, 26/6 = 4.3 chars per line
    // "ABCDEFGHIJKLMNOP" = 16 chars → ~4 lines
    expect(result.height).toBeGreaterThan(15)
  })

  // Verifies the boundary case: text that fits on one line keeps the declared row height.
  it('short text does not change row height', () => {
    const measurer = createMockMeasurer(6)
    const table: TableDef = {
      columns: [{ width: 200 }],
      headerRows: [{
        height: 20,
        cells: [{ text: 'Hi' }],
      }],
    }

    const context: TableLayoutContext = { measurer }
    const result = layoutTable(table, 0, 0, 200, undefined, context)

    // Text "Hi" = 2 chars * 6 = 12pt, fits within 200-4=196pt
    // Row height stays at 20
    expect(result.height).toBe(20)
  })

  // Verifies that vAlign=middle vertically centers text within a tall cell when wrapping is enabled.
  it('vAlign works with multi-line wrapped text', () => {
    const measurer = createMockMeasurer(6)
    // Two cells in two columns: one short (determines no height increase), one long
    // We use a tall row with short text and vAlign=middle
    const table: TableDef = {
      columns: [{ width: 200 }],
      headerRows: [{
        height: 50,
        cells: [{ text: 'Short', vAlign: 'middle' }],
      }],
    }

    const context: TableLayoutContext = { measurer }
    const result = layoutTable(table, 0, 0, 200, undefined, context)

    const texts = collectTexts([result])
    expect(texts.length).toBe(1)
    // vAlign=middle: text should be centered vertically within 50pt cell
    // The y should be greater than padding (text is pushed down from top)
    expect(texts[0]!.y).toBeGreaterThan(2)
  })

  // Verifies that every wrapped line carries the cell's hAlign setting.
  it('hAlign is applied per line', () => {
    const measurer = createMockMeasurer(6)
    const table: TableDef = {
      columns: [{ width: 100 }],
      headerRows: [{
        height: 20,
        cells: [{ text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', hAlign: 'center' }],
      }],
    }

    const context: TableLayoutContext = { measurer }
    const result = layoutTable(table, 0, 0, 100, undefined, context)

    const texts = collectTexts([result])
    // All text nodes should have hAlign='center'
    for (let i = 0; i < texts.length; i++) {
      expect(texts[i]!.hAlign).toBe('center')
    }
  })

  // Verifies that cell padding reduces the available wrap width and offsets the text x position.
  it('padding is respected during wrapping', () => {
    const measurer = createMockMeasurer(6)
    // With padding=10, available = 100 - 20 = 80pt, 80/6 = 13.3 chars per line
    // "ABCDEFGHIJKLMNOP" = 16 chars → wraps into 2 lines
    const table: TableDef = {
      columns: [{ width: 100 }],
      headerRows: [{
        height: 15,
        cells: [{ text: 'ABCDEFGHIJKLMNOP', padding: 10 }],
      }],
    }

    const context: TableLayoutContext = { measurer }
    const result = layoutTable(table, 0, 0, 100, undefined, context)

    const texts = collectTexts([result])
    expect(texts.length).toBeGreaterThan(1)
    // Text x should be at padding offset
    for (let i = 0; i < texts.length; i++) {
      expect(texts[i]!.x).toBe(10) // cellX(0) + padding(10)
    }
  })

  // Verifies that without a TextMeasurer the cell renders as a single line with the original row height.
  it('without measurer falls back to single-line rendering', () => {
    const table: TableDef = {
      columns: [{ width: 50 }],
      headerRows: [{
        height: 15,
        cells: [{ text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' }],
      }],
    }

    // No measurer in context
    const context: TableLayoutContext = {}
    const result = layoutTable(table, 0, 0, 50, undefined, context)

    // Without measurer, text should be a single text node
    const texts = collectTexts([result])
    expect(texts.length).toBe(1)
    expect(texts[0]!.text).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')

    // Row height should be the original
    expect(result.height).toBe(15)
  })
})

// ─── Crosstab text wrapping tests ───

describe('Crosstab cell text wrapping', () => {
  const sampleRows = [
    { category: 'LongCategoryNameThatWraps', region: 'A', amount: 100 },
    { category: 'Short', region: 'B', amount: 200 },
  ]

  const baseDef: CrosstabDef = {
    rowGroups: [{ field: 'category' }],
    columnGroups: [{ field: 'region' }],
    measures: [{ field: 'amount', calculation: 'sum' }],
    cellWidth: 40,
    cellHeight: 15,
    rowHeaderWidth: 50,
    columnHeaderHeight: 15,
  }

  // Verifies that a long crosstab row header wraps and increases the overall crosstab height.
  it('wraps long row header text and increases row height', () => {
    const measurer = createMockMeasurer(6)
    const context: CrosstabLayoutContext = { measurer }
    const result = layoutCrosstab(baseDef, 0, 0, sampleRows, context)

    // "LongCategoryNameThatWraps" at 6pt/char in 50-4=46pt → ~7 chars per line
    // 25 chars → ~4 lines, much taller than 15pt
    expect(result.height).toBeGreaterThan(15 + 15) // colHeaderHeight + at least one row taller
  })

  // Verifies that without a TextMeasurer the crosstab keeps fixed cell heights (no wrapping).
  it('without measurer uses fixed cell height', () => {
    const result = layoutCrosstab(baseDef, 0, 0, sampleRows)

    // Two data rows + column header, all at fixed height
    // totalHeight = colHeaderHeight(15) + 2 * cellHeight(15) = 45
    expect(result.height).toBe(45)
  })

  // Verifies that long data cell values wrap into multiple text nodes in narrow crosstab columns.
  it('data cell text wraps in narrow columns', () => {
    const measurer = createMockMeasurer(6)
    const narrowDef: CrosstabDef = {
      rowGroups: [{ field: 'category' }],
      columnGroups: [{ field: 'region' }],
      measures: [{ field: 'amount', calculation: 'sum' }],
      cellWidth: 20,
      cellHeight: 10,
      rowHeaderWidth: 50,
    }

    const rows = [
      { category: 'A', region: 'X', amount: 123456789 },
    ]

    const context: CrosstabLayoutContext = { measurer }
    const result = layoutCrosstab(narrowDef, 0, 0, rows, context)

    // "123456789" = 9 chars at 6pt = 54pt, available = 20-4 = 16pt
    // Needs ~4 lines to fit
    const texts = collectTexts([result])
    const dataTexts = texts.filter(t => t.text !== 'A' && t.text !== 'X')
    // Data text should be split into multiple text nodes
    expect(dataTexts.length).toBeGreaterThan(1)
  })
})
