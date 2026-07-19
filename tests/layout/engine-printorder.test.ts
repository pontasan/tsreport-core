import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderGroup, RenderText, RenderNode } from '../../src/types/render.js'

// Helpers.

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
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

// Tests.

describe('printOrder', () => {
  // Width 300pt, margin each 0pt -> content 300pt.
  // 2column, columnwidth 140pt, column 20pt.
  
  

  it('printOrder=horizontal + 2列 4行 → 1行目: col0,col1、2行目: col2,col3', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      columns: { count: 2, width: 140, spacing: 20, printOrder: 'horizontal' },
      fields: [{ name: 'val', type: 'string' }],
      bands: {
        details: [{
          height: 20,
          elements: [
            { type: 'textField', x: 0, y: 0, width: 140, height: 20, expression: 'field.val' },
          ],
        }],
      },
    }
    const data: DataSource = {
      rows: [{ val: 'R1' }, { val: 'R2' }, { val: 'R3' }, { val: 'R4' }],
    }
    const doc = createReport(template, data)
    expect(doc.pages.length).toBe(1)

    // Text collect.
    
    const texts = collectTexts(doc.pages[0]!.children)
    const vals = texts.filter(t => ['R1', 'R2', 'R3', 'R4'].includes(t.text))
    expect(vals.length).toBe(4)

    // Detail bandgroup collect (text bandgroup)
    
    const bandGroups = doc.pages[0]!.children.filter(
      (n): n is RenderGroup => n.type === 'group' && collectTexts(n.children).some(
        t => ['R1', 'R2', 'R3', 'R4'].includes(t.text)
      )
    )

    // R1 column0 (x=0), R2 column1 (x=160)
    
    const r1Group = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'R1'))
    const r2Group = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'R2'))
    expect(r1Group).toBeDefined()
    expect(r2Group).toBeDefined()
    expect(r1Group!.x).toBe(0)           // column 0
    expect(r2Group!.x).toBe(160)         // column 1: 0 + 1 * (140 + 20)

    // R1 R2 row (Y coordinate)
    
    expect(r1Group!.y).toBe(r2Group!.y)

    // R3 column0, R4 column1, nextrow.
    
    const r3Group = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'R3'))
    const r4Group = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'R4'))
    expect(r3Group).toBeDefined()
    expect(r4Group).toBeDefined()
    expect(r3Group!.x).toBe(0)
    expect(r4Group!.x).toBe(160)
    // R3/R4 R1/R2 bottom.
    
    expect(r3Group!.y).toBeGreaterThan(r1Group!.y)
  })

  it('printOrder=horizontal + ページ溢れ → 改ページ', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 100, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      columns: { count: 2, width: 140, spacing: 20, printOrder: 'horizontal' },
      fields: [{ name: 'val', type: 'string' }],
      bands: {
        details: [{
          height: 30,
          elements: [
            { type: 'textField', x: 0, y: 0, width: 140, height: 30, expression: 'field.val' },
          ],
        }],
      },
    }
    // 8 rows: 4 horizontal rows × 30pt = 120pt > 100pt -> page.
    
    const data: DataSource = {
      rows: Array.from({ length: 8 }, (_, i) => ({ val: `R${i + 1}` })),
    }
    const doc = createReport(template, data)
    expect(doc.pages.length).toBeGreaterThanOrEqual(2)
  })

  it('printOrder=vertical（デフォルト） → 従来動作', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      columns: { count: 2, width: 140, spacing: 20 },
      fields: [{ name: 'val', type: 'string' }],
      bands: {
        details: [{
          height: 20,
          elements: [
            { type: 'textField', x: 0, y: 0, width: 140, height: 20, expression: 'field.val' },
          ],
        }],
      },
    }
    const data: DataSource = {
      rows: [{ val: 'R1' }, { val: 'R2' }],
    }
    const doc = createReport(template, data)

    // Vertical: R1 R2 column (column0) with Y.
    
    const bandGroups = doc.pages[0]!.children.filter(
      (n): n is RenderGroup => n.type === 'group' && collectTexts(n.children).some(
        t => ['R1', 'R2'].includes(t.text)
      )
    )
    const r1Group = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'R1'))
    const r2Group = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'R2'))
    expect(r1Group).toBeDefined()
    expect(r2Group).toBeDefined()
    // Column X.
    
    expect(r1Group!.x).toBe(r2Group!.x)
    // Y.
    
    expect(r2Group!.y).toBeGreaterThan(r1Group!.y)
  })

  it('printOrder=horizontal + 3列 → 3列横並び', () => {
    const template: ReportTemplate = {
      page: { width: 360, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      columns: { count: 3, width: 100, spacing: 30, printOrder: 'horizontal' },
      fields: [{ name: 'val', type: 'string' }],
      bands: {
        details: [{
          height: 20,
          elements: [
            { type: 'textField', x: 0, y: 0, width: 100, height: 20, expression: 'field.val' },
          ],
        }],
      },
    }
    const data: DataSource = {
      rows: [{ val: 'A' }, { val: 'B' }, { val: 'C' }, { val: 'D' }],
    }
    const doc = createReport(template, data)

    const bandGroups = doc.pages[0]!.children.filter(
      (n): n is RenderGroup => n.type === 'group' && collectTexts(n.children).some(
        t => ['A', 'B', 'C', 'D'].includes(t.text)
      )
    )

    const aGroup = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'A'))
    const bGroup = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'B'))
    const cGroup = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'C'))
    const dGroup = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'D'))

    // A=col0, B=col1, C=col2 -> 1row.
    
    expect(aGroup!.x).toBe(0)
    expect(bGroup!.x).toBe(130)  // 0 + 1 * (100 + 30)
    expect(cGroup!.x).toBe(260)  // 0 + 2 * (100 + 30)
    expect(aGroup!.y).toBe(bGroup!.y)
    expect(bGroup!.y).toBe(cGroup!.y)

    // D=col0 -> 2row.
    
    expect(dGroup!.x).toBe(0)
    expect(dGroup!.y).toBeGreaterThan(aGroup!.y)
  })

  it('printOrder=horizontal + グループ → グループ変更時に列0リセット', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      columns: { count: 2, width: 140, spacing: 20, printOrder: 'horizontal' },
      fields: [
        { name: 'group', type: 'string' },
        { name: 'val', type: 'string' },
      ],
      groups: [{
        name: 'g1',
        expression: 'field.group',
        header: {
          height: 15,
          elements: [
            { type: 'textField', x: 0, y: 0, width: 140, height: 15, expression: 'field.group' },
          ],
        },
      }],
      bands: {
        details: [{
          height: 20,
          elements: [
            { type: 'textField', x: 0, y: 0, width: 140, height: 20, expression: 'field.val' },
          ],
        }],
      },
    }
    // Group A: 3row (R1, R2, R3), group B: 1row (R4)
    // Horizontal 2column: R1=col0, R2=col1, R3 with groupprevious -> col0.
    
    
    const data: DataSource = {
      rows: [
        { group: 'A', val: 'R1' },
        { group: 'A', val: 'R2' },
        { group: 'A', val: 'R3' },
        { group: 'B', val: 'R4' },
      ],
    }
    const doc = createReport(template, data)

    // Groupheadercolumn 0 (x=0) draw.
    
    const allGroups = collectGroups(doc.pages[0]!.children)
    const groupHeaders = allGroups.filter(g =>
      collectTexts(g.children).some(t => t.text === 'A' || t.text === 'B')
    )
    // Groupheaderall x=0 with.
    
    for (const gh of groupHeaders) {
      expect(gh.x).toBe(0)
    }
  })

  it('printOrder=horizontal + columnHeader → 全列にヘッダー描画', () => {
    const template: ReportTemplate = {
      page: { width: 300, height: 400, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      columns: { count: 2, width: 140, spacing: 20, printOrder: 'horizontal' },
      fields: [{ name: 'val', type: 'string' }],
      bands: {
        columnHeader: {
          height: 25,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 140, height: 20, text: 'ColHeader' },
          ],
        },
        details: [{
          height: 20,
          elements: [
            { type: 'textField', x: 0, y: 0, width: 140, height: 20, expression: 'field.val' },
          ],
        }],
      },
    }
    const data: DataSource = {
      rows: [{ val: 'X' }, { val: 'Y' }],
    }
    const doc = createReport(template, data)

    const texts = collectTexts(doc.pages[0]!.children)
    // ColumnHeader 2 (eachcolumn 1)
    
    const headerTexts = texts.filter(t => t.text === 'ColHeader')
    expect(headerTexts.length).toBe(2)

    // Detail data.
    
    expect(texts.some(t => t.text === 'X')).toBe(true)
    expect(texts.some(t => t.text === 'Y')).toBe(true)

    // ColumnHeader group2column place.
    
    const bandGroups = doc.pages[0]!.children.filter(
      (n): n is RenderGroup => n.type === 'group'
    )
    const headerGroups = bandGroups.filter(g => collectTexts(g.children).some(t => t.text === 'ColHeader'))
    expect(headerGroups.length).toBe(2)
    expect(headerGroups[0]!.x).toBe(0)     // column 0
    expect(headerGroups[1]!.x).toBe(160)   // column 1: 0 + 1 * (140 + 20)

    // Detail data columnHeader bottom.
    
    const dataGroup = bandGroups.find(g => collectTexts(g.children).some(t => t.text === 'X'))
    if (headerGroups[0] && dataGroup) {
      expect(dataGroup.y).toBeGreaterThanOrEqual(headerGroups[0]!.y + 25)
    }
  })
})
