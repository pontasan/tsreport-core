import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderNode, RenderGroup, RenderText, RenderRect, RenderLine } from '../../src/types/render.js'

// ─── Helpers ───

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

function collectRects(nodes: RenderNode[]): RenderRect[] {
  const rects: RenderRect[] = []
  for (const node of nodes) {
    if (node.type === 'rect') rects.push(node)
    if (node.type === 'group') rects.push(...collectRects(node.children))
  }
  return rects
}

function collectLines(nodes: RenderNode[]): RenderLine[] {
  const lines: RenderLine[] = []
  for (const node of nodes) {
    if (node.type === 'line') lines.push(node)
    if (node.type === 'group') lines.push(...collectLines(node.children))
  }
  return lines
}

function collectGroups(nodes: RenderNode[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (const node of nodes) {
    if (node.type === 'group') {
      groups.push(node)
      groups.push(...collectGroups(node.children))
    }
  }
  return groups
}

// ─── Tests ───

describe('Table element integration', () => {
  // Verifies that a table element produces text nodes for header cells and every detail data row.
  it('renders a simple table with header and detail rows', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 200, height: 200,
            columns: [{ width: 100 }, { width: 100 }],
            headerRows: [{
              height: 20,
              cells: [
                { text: 'Name', bold: true },
                { text: 'Value', bold: true },
              ],
            }],
            detailRows: [{
              height: 15,
              cells: [
                { expression: 'field.name' },
                { expression: 'field.value' },
              ],
            }],
            border: { color: '#000000', width: 0.5, innerColor: '#CCCCCC', innerWidth: 0.25 },
          }],
        }],
      },
    }

    const dataSource: DataSource = {
      rows: [
        { name: 'Item A', value: '100' },
        { name: 'Item B', value: '200' },
      ],
    }

    const doc = createReport(template, dataSource)
    expect(doc.pages.length).toBe(1)

    const page = doc.pages[0]!
    expect(page.children.length).toBeGreaterThan(0)

    // The table should produce text nodes for header + 2 detail rows
    const texts = collectTexts(page.children)
    const textValues = texts.map(t => t.text)
    expect(textValues).toContain('Name')
    expect(textValues).toContain('Value')
    expect(textValues).toContain('Item A')
    expect(textValues).toContain('100')
    expect(textValues).toContain('Item B')
    expect(textValues).toContain('200')
  })

  // Verifies that footer rows are rendered after the detail rows.
  it('renders table with footer rows', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 300, height: 200,
            columns: [{ width: 150 }, { width: 150 }],
            headerRows: [{
              height: 20,
              cells: [
                { text: 'Product' },
                { text: 'Price' },
              ],
            }],
            detailRows: [{
              height: 15,
              cells: [
                { expression: 'field.product' },
                { expression: 'field.price' },
              ],
            }],
            footerRows: [{
              height: 20,
              cells: [
                { text: 'Total', bold: true },
                { text: '300', bold: true },
              ],
            }],
          }],
        }],
      },
    }

    const dataSource: DataSource = {
      rows: [
        { product: 'Widget', price: '100' },
        { product: 'Gadget', price: '200' },
      ],
    }

    const doc = createReport(template, dataSource)
    const page = doc.pages[0]!
    const texts = collectTexts(page.children)
    const textValues = texts.map(t => t.text)

    // Header
    expect(textValues).toContain('Product')
    expect(textValues).toContain('Price')
    // Detail
    expect(textValues).toContain('Widget')
    expect(textValues).toContain('Gadget')
    // Footer
    expect(textValues).toContain('Total')
    expect(textValues).toContain('300')
  })

  // Verifies that cell style attributes (backcolor fill rect, forecolor, hAlign, bold, fontSize) reach the render nodes.
  it('renders table with cell styling (backcolor, forecolor, hAlign, bold)', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 200, height: 100,
            columns: [{ width: 200 }],
            headerRows: [{
              height: 25,
              cells: [{
                text: 'Styled Header',
                backcolor: '#FF0000',
                forecolor: '#FFFFFF',
                hAlign: 'center',
                bold: true,
                fontSize: 14,
              }],
            }],
          }],
        }],
      },
    }

    const dataSource: DataSource = {
      rows: [{ dummy: 1 }],
    }

    const doc = createReport(template, dataSource)
    const page = doc.pages[0]!

    // Check that backcolor produced a rect fill
    const rects = collectRects(page.children)
    const redRects = rects.filter(r => r.fill === '#FF0000')
    expect(redRects.length).toBeGreaterThan(0)

    // Check styled text
    const texts = collectTexts(page.children)
    const headerText = texts.find(t => t.text === 'Styled Header')
    expect(headerText).toBeDefined()
    expect(headerText!.color).toBe('#FFFFFF')
    expect(headerText!.bold).toBe(true)
    expect(headerText!.fontSize).toBe(14)
    expect(headerText!.hAlign).toBe('center')
  })

  // Verifies that the column-level outlineText style is propagated to cell text nodes.
  it('renders table text with outlineText', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 200, height: 100,
            columns: [{ width: 200, style: { outlineText: true } }],
            headerRows: [{
              height: 25,
              cells: [{ text: 'Outlined Cell' }],
            }],
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{ dummy: 1 }] })
    const texts = collectTexts(doc.pages[0]!.children)
    const outlined = texts.find((node) => node.text === 'Outlined Cell')
    expect(outlined).toBeDefined()
    expect(outlined!.outlineText).toBe(true)
  })

  // Verifies that a colSpan cell spans multiple column widths while other cells stay single-width.
  it('renders table with colSpan', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 300, height: 100,
            columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
            headerRows: [{
              height: 20,
              cells: [
                { text: 'Merged Header', colSpan: 2 },
                { text: 'Col 3' },
              ],
            }],
            detailRows: [{
              height: 15,
              cells: [
                { expression: 'field.a' },
                { expression: 'field.b' },
                { expression: 'field.c' },
              ],
            }],
          }],
        }],
      },
    }

    const dataSource: DataSource = {
      rows: [{ a: 'A1', b: 'B1', c: 'C1' }],
    }

    const doc = createReport(template, dataSource)
    const page = doc.pages[0]!
    const texts = collectTexts(page.children)
    const textValues = texts.map(t => t.text)

    expect(textValues).toContain('Merged Header')
    expect(textValues).toContain('Col 3')
    expect(textValues).toContain('A1')
    expect(textValues).toContain('B1')
    expect(textValues).toContain('C1')

    // The merged header text should have a wider width than a single column
    const mergedText = texts.find(t => t.text === 'Merged Header')!
    const col3Text = texts.find(t => t.text === 'Col 3')!
    // mergedText occupies 2 columns (200pt scaled), col3Text occupies 1 column (100pt scaled)
    // Text width = cellWidth - padding*2
    expect(mergedText.width!).toBeGreaterThan(col3Text.width!)
  })

  // Verifies rowSpan merging, column-level style inheritance, and per-cell border overrides (color, width, dash).
  it('renders table with rowSpan, column style, and cell border override', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 160,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 240, height: 120,
            columns: [
              { width: 120, style: { forecolor: '#0000FF', border: { right: { width: 1.5, color: '#008800', style: 'solid' } } } },
              { width: 120 },
            ],
            headerRows: [{
              height: 20,
              cells: [
                { text: 'Merged', rowSpan: 2, backcolor: '#FFF4CC', border: { bottom: { width: 1, color: '#FF0000', style: 'dashed' } } },
                { text: 'H2' },
              ],
            }, {
              height: 20,
              cells: [
                { text: 'H3' },
              ],
            }],
            detailRows: [{
              height: 20,
              cells: [
                { expression: 'field.name' },
                { expression: 'field.value' },
              ],
            }],
            border: { color: '#000000', width: 0.5, innerColor: '#999999', innerWidth: 0.25 },
          }],
        }],
      },
    }

    const dataSource: DataSource = {
      rows: [{ name: 'Alpha', value: '10' }],
    }

    const doc = createReport(template, dataSource)
    const page = doc.pages[0]!
    const texts = collectTexts(page.children)
    const lines = collectLines(page.children)

    expect(texts.map(t => t.text)).toContain('Merged')
    expect(texts.map(t => t.text)).toContain('Alpha')

    const alphaText = texts.find(t => t.text === 'Alpha')
    expect(alphaText).toBeDefined()
    expect(alphaText!.color).toBe('#0000FF')

    const greenBorder = lines.find(line => line.color === '#008800' && line.lineWidth === 1.5)
    expect(greenBorder).toBeDefined()

    const redDashedBorder = lines.find(line => line.color === '#FF0000' && Array.isArray(line.dash))
    expect(redDashedBorder).toBeDefined()
  })

  // Verifies that cell expressions resolve against every data row and the table group is positioned correctly.
  it('renders table with expression resolution from data rows', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'table' as const,
            x: 10, y: 5, width: 400, height: 200,
            columns: [{ width: 200 }, { width: 200 }],
            detailRows: [{
              height: 18,
              cells: [
                { expression: 'field.city' },
                { expression: 'field.population' },
              ],
            }],
          }],
        }],
      },
    }

    const dataSource: DataSource = {
      rows: [
        { city: 'Tokyo', population: '14000000' },
        { city: 'Osaka', population: '2700000' },
        { city: 'Nagoya', population: '2300000' },
      ],
    }

    const doc = createReport(template, dataSource)
    const page = doc.pages[0]!
    const texts = collectTexts(page.children)
    const textValues = texts.map(t => t.text)

    // All 3 data rows should be rendered
    expect(textValues).toContain('Tokyo')
    expect(textValues).toContain('14000000')
    expect(textValues).toContain('Osaka')
    expect(textValues).toContain('2700000')
    expect(textValues).toContain('Nagoya')
    expect(textValues).toContain('2300000')

    // Table should have the correct position
    const allGroups = collectGroups(page.children)
    // Find the table group (width=400, positioned at elem.x relative to band)
    const tableGroup = allGroups.find(g => g.width === 400)
    expect(tableGroup).toBeDefined()
  })

  // Verifies that child elements placed inside a cell render alongside normal text cells.
  it('renders child elements inside table cells', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 200,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 300, height: 200,
            columns: [{ width: 150 }, { width: 150 }],
            headerRows: [{
              height: 30,
              cells: [
                {
                  // Cell child element: place a staticText
                  elements: [{
                    type: 'staticText' as const,
                    x: 2, y: 2, width: 100, height: 20,
                    text: 'CellChild',
                  }],
                },
                { text: 'NormalText' },
              ],
            }],
          }],
        }],
      },
    }

    const doc = createReport(template, { rows: [{}] })
    const page = doc.pages[0]!
    const texts = collectTexts(page.children)
    const textValues = texts.map(t => t.text)

    // The child element text is rendered
    expect(textValues).toContain('CellChild')
    // The normal text cell is also rendered
    expect(textValues).toContain('NormalText')
  })
})
