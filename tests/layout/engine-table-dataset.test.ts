import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
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

function collectAllTextValues(doc: { pages: { children: RenderNode[] }[] }): string[] {
  const values: string[] = []
  for (const page of doc.pages) {
    for (const t of collectTexts(page.children)) values.push(t.text)
  }
  return values
}

// ─── Tests ───

// Tests for table sub-datasets driven by dataSourceExpression (template sub-dataset behavior).
describe('テーブルのサブデータセット（dataSourceExpression）', () => {
  // Verifies that a table in the detail band iterates over the parent row's nested array, once per parent row.
  it('detail バンド内のテーブルが親行のネスト配列で反復される', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 120,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 300, height: 100,
            dataSourceExpression: 'field.items',
            columns: [{ width: 150 }, { width: 150 }],
            headerRows: [{
              height: 20,
              cells: [{ text: 'SKU' }, { text: 'Qty' }],
            }],
            detailRows: [{
              height: 15,
              cells: [
                { expression: 'field.sku' },
                { expression: 'field.qty' },
              ],
            }],
          }],
        }],
      },
    }

    const dataSource: DataSource = {
      rows: [
        {
          orderNo: 'ORD-1',
          items: [
            { sku: 'A-001', qty: '2' },
            { sku: 'A-002', qty: '5' },
          ],
        },
        {
          orderNo: 'ORD-2',
          items: [
            { sku: 'B-001', qty: '1' },
            { sku: 'B-002', qty: '3' },
            { sku: 'B-003', qty: '7' },
          ],
        },
      ],
    }

    const doc = createReport(template, dataSource)
    expect(doc.pages.length).toBe(1)

    const textValues = collectAllTextValues(doc)

    // Table for parent row 1: 2 items
    expect(textValues.filter(t => t === 'A-001').length).toBe(1)
    expect(textValues.filter(t => t === 'A-002').length).toBe(1)
    // Table for parent row 2: 3 items
    expect(textValues.filter(t => t === 'B-001').length).toBe(1)
    expect(textValues.filter(t => t === 'B-002').length).toBe(1)
    expect(textValues.filter(t => t === 'B-003').length).toBe(1)

    // The header is rendered per detail band (once for each of the 2 parent rows)
    expect(textValues.filter(t => t === 'SKU').length).toBe(2)
  })

  // Verifies that cell expressions resolve fields against the sub-dataset row, shadowing same-named parent fields.
  it('サブデータセット行の field 参照がテーブルセル式で解決される', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 200, height: 80,
            dataSourceExpression: 'field.children',
            columns: [{ width: 200 }],
            detailRows: [{
              height: 15,
              cells: [{ expression: 'field.label' }],
            }],
          }],
        }],
      },
    }

    const dataSource: DataSource = {
      rows: [{
        // The parent row also has a label, but the sub-dataset's label must be used
        label: 'PARENT-LABEL',
        children: [
          { label: 'CHILD-1' },
          { label: 'CHILD-2' },
        ],
      }],
    }

    const doc = createReport(template, dataSource)
    const textValues = collectAllTextValues(doc)

    expect(textValues).toContain('CHILD-1')
    expect(textValues).toContain('CHILD-2')
    expect(textValues).not.toContain('PARENT-LABEL')
  })

  // Verifies that main-dataset fields and variables still resolve normally for elements outside the table.
  it('メインデータセットの field/variables はテーブル外の要素で従来どおり参照できる', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      variables: [{
        name: 'itemTotal',
        expression: 'field.amount',
        calculation: 'sum',
      }],
      bands: {
        details: [{
          height: 100,
          elements: [
            {
              type: 'textField' as const,
              x: 0, y: 0, width: 200, height: 15,
              expression: 'field.orderNo',
            },
            {
              type: 'table' as const,
              x: 0, y: 20, width: 200, height: 60,
              dataSourceExpression: 'field.items',
              columns: [{ width: 200 }],
              detailRows: [{
                height: 15,
                cells: [{ expression: 'field.sku' }],
              }],
            },
          ],
        }],
        summary: {
          height: 20,
          elements: [{
            type: 'textField' as const,
            x: 0, y: 0, width: 200, height: 15,
            expression: 'vars.itemTotal',
          }],
        },
      },
    }

    const dataSource: DataSource = {
      rows: [
        { orderNo: 'ORD-1', amount: 100, items: [{ sku: 'A-001' }] },
        { orderNo: 'ORD-2', amount: 250, items: [{ sku: 'B-001' }] },
      ],
    }

    const doc = createReport(template, dataSource)
    const textValues = collectAllTextValues(doc)

    // Main-dataset field references (outside the table)
    expect(textValues).toContain('ORD-1')
    expect(textValues).toContain('ORD-2')
    // Main-dataset variables (summary band)
    expect(textValues).toContain('350')
    // Sub-dataset rows are rendered inside the table
    expect(textValues).toContain('A-001')
    expect(textValues).toContain('B-001')
  })

  // Verifies the error path: a dataSourceExpression that evaluates to a non-array throws.
  it('配列以外を返す dataSourceExpression はエラー', () => {
    const template: ReportTemplate = {
      page: { width: 595, height: 842, margins: { top: 20, bottom: 20, left: 20, right: 20 } },
      bands: {
        details: [{
          height: 100,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 200, height: 80,
            dataSourceExpression: 'field.notAnArray',
            columns: [{ width: 200 }],
            detailRows: [{
              height: 15,
              cells: [{ expression: 'field.label' }],
            }],
          }],
        }],
      },
    }

    const dataSource: DataSource = {
      rows: [{ notAnArray: 'just a string' }],
    }

    expect(() => createReport(template, dataSource)).toThrowError(
      /Table dataSourceExpression must evaluate to an array of rows, got string/,
    )
  })

  // Verifies that table page breaking still works with a large sub-dataset: all rows render and headers repeat per page.
  it('大きなサブデータセットでテーブル改ページが従来どおり機能する', () => {
    const template: ReportTemplate = {
      page: {
        width: 300, height: 200,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 500,
          elements: [{
            type: 'table' as const,
            x: 0, y: 0, width: 300, height: 500,
            dataSourceExpression: 'field.entries',
            columns: [{ width: 300 }],
            headerRows: [{ height: 20, cells: [{ text: 'HEADER' }] }],
            detailRows: [{ height: 20, cells: [{ expression: 'field.v' }] }],
          }],
        }],
      },
    }

    // 30 rows x 20pt = 600pt + header 20pt > 200pt page height, so multiple pages
    const entries: Record<string, unknown>[] = []
    for (let i = 0; i < 30; i++) entries.push({ v: `Row ${i}` })
    const dataSource: DataSource = {
      rows: [{ entries }],
    }

    const doc = createReport(template, dataSource)
    expect(doc.pages.length).toBeGreaterThan(1)

    // Every sub-dataset row appears on some page
    const textValues = collectAllTextValues(doc)
    for (let i = 0; i < 30; i++) {
      expect(textValues).toContain(`Row ${i}`)
    }

    // The header is re-rendered on every page
    for (const page of doc.pages) {
      const texts = collectTexts(page.children)
      expect(texts.some(t => t.text === 'HEADER')).toBe(true)
    }
  })
})
