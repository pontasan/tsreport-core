import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderText, RenderNode } from '../../src/types/render.js'

// ─── Helpers ───

function collectTexts(nodes: RenderNode[]): RenderText[] {
  const texts: RenderText[] = []
  for (const node of nodes) {
    if (node.type === 'text') texts.push(node)
    if (node.type === 'group') texts.push(...collectTexts(node.children))
  }
  return texts
}

// ─── Tests ───

// Group keepTogether: break to a new page when the whole group cannot fit in the remaining space.
describe('keepTogether', () => {
  // Page height 200pt, margins 20pt each -> content area = 160pt
  // pageHeader 20pt -> 140pt remaining
  // pageFooter 20pt -> usable detail area = 120pt
  const makeTemplate = (keepTogether: boolean, detailHeight: number): ReportTemplate => ({
    page: {
      width: 300, height: 200,
      margins: { top: 20, bottom: 20, left: 20, right: 20 },
    },
    fields: [
      { name: 'group', type: 'string' },
      { name: 'item', type: 'string' },
    ],
    groups: [{
      name: 'g',
      expression: 'field.group',
      keepTogether,
      header: {
        height: 15,
        elements: [
          { type: 'textField', x: 0, y: 0, width: 200, height: 15, expression: 'field.group' },
        ],
      },
      footer: {
        height: 10,
        elements: [
          { type: 'staticText', x: 0, y: 0, width: 200, height: 10, text: 'Footer' },
        ],
      },
    }],
    bands: {
      pageHeader: {
        height: 20,
        elements: [
          { type: 'staticText', x: 0, y: 0, width: 200, height: 15, text: 'PageHeader' },
        ],
      },
      details: [{
        height: detailHeight,
        elements: [
          { type: 'textField', x: 0, y: 0, width: 200, height: detailHeight, expression: 'field.item' },
        ],
      }],
      pageFooter: {
        height: 20,
        elements: [
          { type: 'staticText', x: 0, y: 0, width: 200, height: 15, text: 'PageFooter' },
        ],
      },
    },
  })

  // Verifies that no page break occurs when the whole group fits in the remaining space.
  it('keepTogether=true + 残スペースに収まる → 改ページなし', () => {
    // detail 20pt x 2 rows + header 15pt + footer 10pt = 65pt < 120pt
    const template = makeTemplate(true, 20)
    const data: DataSource = {
      rows: [
        { group: 'G1', item: 'A' },
        { group: 'G1', item: 'B' },
      ],
    }
    const doc = createReport(template, data)
    expect(doc.pages.length).toBe(1)
    const texts = collectTexts(doc.pages[0]!.children)
    expect(texts.some(t => t.text === 'A')).toBe(true)
    expect(texts.some(t => t.text === 'B')).toBe(true)
  })

  // Verifies that a group not fitting the remaining space but fitting a full page starts on a new page.
  it('keepTogether=true + 残スペース不足 & フルページに収まる → 改ページしてからグループ開始', () => {
    // The first group consumes most of the space, so the second group does not fit in what remains
    // detail 25pt: G1 3 rows = 75pt + header 15 + footer 10 = 100pt -> 20pt remaining
    // G2 2 rows = 50pt + header 15 + footer 10 = 75pt > 20pt remaining -> keepTogether forces a page break
    const template = makeTemplate(true, 25)
    const data: DataSource = {
      rows: [
        { group: 'G1', item: 'A' },
        { group: 'G1', item: 'B' },
        { group: 'G1', item: 'C' },
        { group: 'G2', item: 'D' },
        { group: 'G2', item: 'E' },
      ],
    }
    const doc = createReport(template, data)
    // G2 lands on page 2 after the break
    expect(doc.pages.length).toBe(2)
    const page2Texts = collectTexts(doc.pages[1]!.children)
    expect(page2Texts.some(t => t.text === 'D')).toBe(true)
    expect(page2Texts.some(t => t.text === 'E')).toBe(true)
  })

  // Verifies that keepTogether is abandoned when the group is taller than a full page.
  it('keepTogether=true + グループがフルページより大きい → 改ページしない', () => {
    // detail 30pt x 5 rows = 150pt + header 15 + footer 10 = 175pt > 120pt (full page)
    // The group cannot fit a full page, so keepTogether does not force a page break
    const template = makeTemplate(true, 30)
    const data: DataSource = {
      rows: [
        { group: 'G1', item: 'A' },
        { group: 'G1', item: 'B' },
        { group: 'G1', item: 'C' },
        { group: 'G1', item: 'D' },
        { group: 'G1', item: 'E' },
      ],
    }
    const doc = createReport(template, data)
    // The group is rendered across pages (keepTogether gives up)
    const page1Texts = collectTexts(doc.pages[0]!.children)
    expect(page1Texts.some(t => t.text === 'A')).toBe(true)
    // Spans multiple pages
    expect(doc.pages.length).toBeGreaterThanOrEqual(2)
  })

  // Verifies that keepTogether=false keeps the legacy overflow behavior (group may be split).
  it('keepTogether 未指定 → 従来通り', () => {
    // keepTogether=false -> no forced break (space shortage is handled by normal overflow)
    const template = makeTemplate(false, 25)
    const data: DataSource = {
      rows: [
        { group: 'G1', item: 'A' },
        { group: 'G1', item: 'B' },
        { group: 'G1', item: 'C' },
        { group: 'G2', item: 'D' },
        { group: 'G2', item: 'E' },
      ],
    }
    const doc = createReport(template, data)
    // Even without keepTogether a page break can still occur through overflow
    // What matters is the difference from keepTogether=true: G2 may be split
    const page1Texts = collectTexts(doc.pages[0]!.children)
    // The G2 header or its first row may appear on page 1
    expect(page1Texts.some(t => t.text === 'A')).toBe(true)
  })

  // Verifies that the very first group does not trigger an unnecessary page break.
  it('keepTogether=true + 最初のグループ → 不要な改ページなし', () => {
    // The first group runs processGroupBreaks with isFirst=true but needs no page break
    const template = makeTemplate(true, 20)
    const data: DataSource = {
      rows: [
        { group: 'G1', item: 'A' },
        { group: 'G1', item: 'B' },
      ],
    }
    const doc = createReport(template, data)
    expect(doc.pages.length).toBe(1)
  })
})
