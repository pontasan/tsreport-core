import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderGroup, RenderText, RenderNode } from '../../src/types/render.js'

// ─── Helpers ───

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

// ─── Tests ───

// Title/summary startNewPage flags and the legacy titleNewPage report option.
describe('band startNewPage / legacy titleNewPage', () => {
  const baseTemplate: ReportTemplate = {
    page: { size: 'A4', margins: { top: 30, bottom: 30, left: 20, right: 20 } },
    bands: {
      title: {
        height: 40,
        elements: [
          { type: 'staticText', x: 0, y: 10, width: 200, height: 20, text: 'Title' },
        ],
      },
      pageHeader: {
        height: 20,
        elements: [
          { type: 'staticText', x: 0, y: 0, width: 200, height: 15, text: 'PageHeader' },
        ],
      },
      details: [{
        height: 20,
        elements: [
          { type: 'textField', x: 0, y: 0, width: 200, height: 20, expression: 'field.name' },
        ],
      }],
      summary: {
        height: 30,
        elements: [
          { type: 'staticText', x: 0, y: 5, width: 200, height: 20, text: 'Summary' },
        ],
      },
      pageFooter: {
        height: 20,
        elements: [
          { type: 'staticText', x: 0, y: 0, width: 200, height: 15, text: 'PageFooter' },
        ],
      },
    },
  }

  const data: DataSource = {
    rows: [{ name: 'A' }, { name: 'B' }],
  }

  // Verifies that title.startNewPage puts the title on its own page without page header/footer (per common report behavior).
  it('title.startNewPage=true → title が独立ページ、detail は2ページ目', () => {
    const template: ReportTemplate = {
      ...baseTemplate,
      bands: {
        ...baseTemplate.bands,
        title: {
          ...baseTemplate.bands.title!,
          startNewPage: true,
        },
      },
    }
    const doc = createReport(template, data)

    // At least 2 pages
    expect(doc.pages.length).toBeGreaterThanOrEqual(2)

    // Page 1: Title only (no pageHeader/pageFooter, per common report behavior)
    const page1Texts = collectTexts(doc.pages[0]!.children)
    expect(page1Texts.some(t => t.text === 'Title')).toBe(true)
    expect(page1Texts.some(t => t.text === 'A')).toBe(false)
    expect(page1Texts.some(t => t.text === 'PageHeader')).toBe(false)
    expect(page1Texts.some(t => t.text === 'PageFooter')).toBe(false)

    // Page 2: detail data
    const page2Texts = collectTexts(doc.pages[1]!.children)
    expect(page2Texts.some(t => t.text === 'A')).toBe(true)
  })

  // Verifies that without startNewPage the title shares the first page with details.
  it('title.startNewPage 未指定 → 従来通り同一ページ', () => {
    const doc = createReport(baseTemplate, data)

    // Fits on one page
    expect(doc.pages.length).toBe(1)
    const texts = collectTexts(doc.pages[0]!.children)
    expect(texts.some(t => t.text === 'Title')).toBe(true)
    expect(texts.some(t => t.text === 'A')).toBe(true)
  })

  // Verifies that the pageHeader still renders on the page following a standalone title page.
  it('title.startNewPage=true + pageHeader → 2ページ目にも pageHeader 描画', () => {
    const template: ReportTemplate = {
      ...baseTemplate,
      bands: {
        ...baseTemplate.bands,
        title: {
          ...baseTemplate.bands.title!,
          startNewPage: true,
        },
      },
    }
    const doc = createReport(template, data)

    // Page 2 has the PageHeader
    const page2Texts = collectTexts(doc.pages[1]!.children)
    expect(page2Texts.some(t => t.text === 'PageHeader')).toBe(true)
  })

  // Verifies that summary.startNewPage moves the summary to its own final page.
  it('summary.startNewPage=true → summary が独立ページ', () => {
    const template: ReportTemplate = {
      ...baseTemplate,
      bands: {
        ...baseTemplate.bands,
        summary: {
          ...baseTemplate.bands.summary!,
          startNewPage: true,
        },
      },
    }
    const doc = createReport(template, data)

    expect(doc.pages.length).toBeGreaterThanOrEqual(2)

    // The last page has the Summary
    const lastPage = doc.pages[doc.pages.length - 1]!
    const lastTexts = collectTexts(lastPage.children)
    expect(lastTexts.some(t => t.text === 'Summary')).toBe(true)

    // The previous page has no Summary
    const prevTexts = collectTexts(doc.pages[doc.pages.length - 2]!.children)
    expect(prevTexts.some(t => t.text === 'Summary')).toBe(false)
  })

  // Verifies that without startNewPage the summary stays on the same page as details.
  it('summary.startNewPage 未指定 → 従来通り同一ページ', () => {
    const doc = createReport(baseTemplate, data)

    expect(doc.pages.length).toBe(1)
    const texts = collectTexts(doc.pages[0]!.children)
    expect(texts.some(t => t.text === 'Summary')).toBe(true)
    expect(texts.some(t => t.text === 'A')).toBe(true)
  })

  // Verifies that the standalone summary page has no page header/footer by default (common report default).
  it('summary.startNewPage=true → summary ページに pageFooter なし（一般的な帳票動作）', () => {
    const template: ReportTemplate = {
      ...baseTemplate,
      bands: {
        ...baseTemplate.bands,
        summary: {
          ...baseTemplate.bands.summary!,
          startNewPage: true,
        },
      },
    }
    const doc = createReport(template, data)

    const lastPage = doc.pages[doc.pages.length - 1]!
    const lastTexts = collectTexts(lastPage.children)
    // Default: summaryWithPageHeaderAndFooter=false -> no pageFooter
    expect(lastTexts.some(t => t.text === 'PageFooter')).toBe(false)
    expect(lastTexts.some(t => t.text === 'PageHeader')).toBe(false)
  })

  // Verifies that summaryWithPageHeaderAndFooter=true renders page header/footer on the summary page.
  it('summary.startNewPage=true + summaryWithPageHeaderAndFooter=true → summary ページに pageHeader/pageFooter あり', () => {
    const template: ReportTemplate = {
      ...baseTemplate,
      summaryWithPageHeaderAndFooter: true,
      bands: {
        ...baseTemplate.bands,
        summary: {
          ...baseTemplate.bands.summary!,
          startNewPage: true,
        },
      },
    }
    const doc = createReport(template, data)

    const lastPage = doc.pages[doc.pages.length - 1]!
    const lastTexts = collectTexts(lastPage.children)
    expect(lastTexts.some(t => t.text === 'Summary')).toBe(true)
    expect(lastTexts.some(t => t.text === 'PageHeader')).toBe(true)
    expect(lastTexts.some(t => t.text === 'PageFooter')).toBe(true)
  })

  // Verifies that column header/footer never appear on the summary page even with page header/footer enabled.
  it('summary.startNewPage=true + summaryWithPageHeaderAndFooter=true でも summary ページに columnHeader/columnFooter は出ない', () => {
    const template: ReportTemplate = {
      ...baseTemplate,
      columns: { count: 2, width: 90, spacing: 0 },
      summaryWithPageHeaderAndFooter: true,
      bands: {
        ...baseTemplate.bands,
        columnHeader: {
          height: 16,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 120, height: 12, text: 'ColumnHeader' },
          ],
        },
        columnFooter: {
          height: 16,
          elements: [
            { type: 'staticText', x: 0, y: 0, width: 120, height: 12, text: 'ColumnFooter' },
          ],
        },
        summary: {
          ...baseTemplate.bands.summary!,
          startNewPage: true,
        },
      },
    }
    const doc = createReport(template, data)

    const lastPage = doc.pages[doc.pages.length - 1]!
    const lastTexts = collectTexts(lastPage.children)
    expect(lastTexts.some(t => t.text === 'Summary')).toBe(true)
    expect(lastTexts.some(t => t.text === 'PageHeader')).toBe(true)
    expect(lastTexts.some(t => t.text === 'PageFooter')).toBe(true)
    expect(lastTexts.some(t => t.text === 'ColumnHeader')).toBe(false)
    expect(lastTexts.some(t => t.text === 'ColumnFooter')).toBe(false)
  })

  // Verifies that the legacy report-level titleNewPage option still forces the title onto its own page.
  it('legacy titleNewPage=true も従来どおり維持する', () => {
    const template: ReportTemplate = { ...baseTemplate, titleNewPage: true }
    const doc = createReport(template, data)
    const page1Texts = collectTexts(doc.pages[0]!.children)
    const page2Texts = collectTexts(doc.pages[1]!.children)

    expect(page1Texts.some(t => t.text === 'Title')).toBe(true)
    expect(page2Texts.some(t => t.text === 'A')).toBe(true)
  })
})

describe('page transparency group', () => {
  it('propagates the page blending group to regular and dedicated summary pages', () => {
    const transparencyGroup = {
      colorSpace: { kind: 'rgb' as const },
      isolated: false,
      knockout: false,
    }
    const template: ReportTemplate = {
      page: {
        width: 200,
        height: 200,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        transparencyGroup,
      },
      summaryNewPage: true,
      bands: {
        details: [{ height: 20, elements: [] }],
        summary: { height: 20, elements: [] },
      },
    }

    const doc = createReport(template, { rows: [{}] })

    expect(doc.pages).toHaveLength(2)
    expect(doc.pages[0]!.transparencyGroup).toEqual(transparencyGroup)
    expect(doc.pages[1]!.transparencyGroup).toEqual(transparencyGroup)
  })
})
