import { describe, it, expect } from 'vitest'
import { createReport } from '../../src/layout/engine.js'
import type { ReportTemplate, DataSource } from '../../src/types/template.js'
import type { RenderGroup } from '../../src/types/render.js'

// ─── Helpers ───

/** Collect the top-level groups (bands) directly under a page */
function topGroups(page: import('../../src/types/render.js').RenderPage): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (let i = 0; i < page.children.length; i++) {
    const child = page.children[i]!
    if (child.type === 'group') groups.push(child)
  }
  return groups
}

// ─── Tests ───

describe('band spacingBefore / spacingAfter', () => {
  // Verifies that spacingBefore adds space before each band instance.
  it('spacingBefore はバンド前にスペースを追加する', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 30,
          spacingBefore: 10,
          elements: [],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}, {}] })
    const groups = topGroups(doc.pages[0]!)

    // Row 1: spacingBefore=10 -> the band starts at y=10
    expect(groups[0]!.y).toBe(10)
    // Row 2: row 1 y(10) + height(30) + spacingBefore(10) = 50
    expect(groups[1]!.y).toBe(50)
  })

  // Verifies that spacingAfter adds space after each band instance.
  it('spacingAfter はバンド後にスペースを追加する', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 30,
          spacingAfter: 15,
          elements: [],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}, {}] })
    const groups = topGroups(doc.pages[0]!)

    // Row 1: y=0
    expect(groups[0]!.y).toBe(0)
    // Row 2: 0 + height(30) + spacingAfter(15) = 45
    expect(groups[1]!.y).toBe(45)
  })

  // Verifies that spacingBefore and spacingAfter accumulate when both are specified.
  it('spacingBefore と spacingAfter を両方指定', () => {
    const template: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 20,
          spacingBefore: 5,
          spacingAfter: 10,
          elements: [],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}, {}, {}] })
    const groups = topGroups(doc.pages[0]!)

    // Row 1: spacingBefore=5 -> y=5, height=20
    expect(groups[0]!.y).toBe(5)
    // Row 2: 5 + 20 + spacingAfter(10) + spacingBefore(5) = 40
    expect(groups[1]!.y).toBe(40)
    // Row 3: 40 + 20 + 10 + 5 = 75
    expect(groups[2]!.y).toBe(75)
  })

  // Verifies that spacing is included in the band's effective height for page break decisions.
  it('spacing によりページブレークが発生する', () => {
    // Content area: 100pt
    // Band height=30, spacingAfter=20 -> totalHeight=50
    // 30pt*3 = 90 -> fits on one page without spacing
    // 50pt*2 = 100 fits two rows, the third row goes to page 2
    const template: ReportTemplate = {
      page: {
        width: 200, height: 100,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 30,
          spacingAfter: 20,
          elements: [],
        }],
      },
    }
    const doc = createReport(template, { rows: [{}, {}, {}] })
    expect(doc.pages.length).toBe(2)

    // Page 1: 2 rows
    const p1groups = topGroups(doc.pages[0]!)
    expect(p1groups.length).toBe(2)

    // Page 2: 1 row
    const p2groups = topGroups(doc.pages[1]!)
    expect(p2groups.length).toBe(1)
  })

  // Verifies that spacing=0 behaves identically to leaving spacing undefined.
  it('spacing=0 と undefined は同等（影響なし）', () => {
    const templateZero: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 25,
          spacingBefore: 0,
          spacingAfter: 0,
          elements: [],
        }],
      },
    }
    const templateUndef: ReportTemplate = {
      page: {
        width: 200, height: 400,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      bands: {
        details: [{
          height: 25,
          elements: [],
        }],
      },
    }
    const data: DataSource = { rows: [{}, {}, {}] }
    const docZero = createReport(templateZero, data)
    const docUndef = createReport(templateUndef, data)

    const groupsZero = topGroups(docZero.pages[0]!)
    const groupsUndef = topGroups(docUndef.pages[0]!)

    expect(groupsZero.length).toBe(groupsUndef.length)
    for (let i = 0; i < groupsZero.length; i++) {
      expect(groupsZero[i]!.y).toBe(groupsUndef[i]!.y)
      expect(groupsZero[i]!.height).toBe(groupsUndef[i]!.height)
    }
  })
})
